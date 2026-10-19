# python3 -I tests/test_menu.py — approval-menu parsing and scope checks on fixed screens.
# The screens follow the menu lyjw captured from Devin CLI v3000.11.92 --sandbox:
# a "⏺ Writing <path>" header, then 1 Approve once / 2 allow edits in <dir> / 3 always / 4 No.
import importlib.util, os, shutil, subprocess, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('dv', Path(__file__).resolve().parent.parent / 'scripts/dv.py')
dv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dv)

MENU = """\
⏺ {tool} {path}
  ╭──────────────────────────────╮
  │ BRIEF-OK                     │
  ╰──────────────────────────────╯

 Do you want to make this edit?
 ❯ 1. Yes (Approve once)
   2. Yes, allow edits in {dir}
   3. Yes, always allow edits
   4. No
"""


def screen(tool, path, d):
    return MENU.format(tool=tool, path=path, dir=d).splitlines()


class MenuScope(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        self.wt = self.tmp / 'wt'
        subprocess.run(['git', '-C', str(self.repo), '-c', 'commit.gpgsign=false', 'commit', '-q',
                        '--allow-empty', '-m', 'init'], check=True)
        subprocess.run(['git', '-C', str(self.repo), 'worktree', 'add', '-q', str(self.wt)], check=True)
        self.cwd = str(self.wt)
        self.common = dv.git_common_dir(self.wt)
        (self.tmp / 'outside').mkdir()
        os.symlink(self.tmp / 'outside', self.wt / 'link')

    def verdict(self, tool, path, d):
        return dv.menu_verdict(screen(tool, path, d), self.cwd, self.common)

    def test_common_dir_is_main_repo_git(self):
        self.assertEqual(self.common, os.path.realpath(self.repo / '.git'))

    def test_inside_relative_and_absolute(self):
        self.assertEqual(self.verdict('Writing', 'b.txt', self.cwd), (True, 'b.txt'))
        self.assertTrue(self.verdict('Editing', f'{self.cwd}/src/a.ts', f'{self.cwd}/src')[0])

    def test_outside_absolute(self):
        out = f'{self.tmp}/outside/edit.txt'
        ok, why = self.verdict('Writing', out, f'{self.tmp}/outside')
        self.assertFalse(ok)
        self.assertIn('outside', why)

    def test_dotdot_and_symlink_escape(self):
        self.assertFalse(self.verdict('Writing', '../outside/edit.txt', self.cwd)[0])
        self.assertFalse(self.verdict('Writing', 'link/edit.txt', f'{self.cwd}/link')[0])

    def test_sibling_prefix_is_not_inside(self):
        self.assertFalse(self.verdict('Writing', f'{self.cwd}-evil/x', f'{self.cwd}-evil')[0])

    def test_allow_dir_outside_blocks(self):
        self.assertFalse(self.verdict('Writing', 'b.txt', '/etc')[0])

    def test_git_common_dir(self):
        self.assertTrue(self.verdict('Writing', f'{self.common}/refs/heads/x', f'{self.common}/refs/heads')[0])
        self.assertFalse(self.verdict('Writing', f'{self.common}/hooks/pre-commit', f'{self.common}/hooks')[0])
        self.assertFalse(self.verdict('Editing', f'{self.common}/config', self.common)[0])

    def test_plain_checkout_git_dir(self):
        cwd, common = str(self.repo), dv.git_common_dir(self.repo)
        check = lambda p: dv.menu_verdict(screen('Writing', p, os.path.dirname(f'{cwd}/{p}')), cwd, common)[0]
        self.assertTrue(check('src/a.ts'))
        self.assertTrue(check('.git/refs/heads/x'))
        self.assertFalse(check('.git/hooks/pre-commit'))
        self.assertFalse(check('.git/config'))
        self.assertFalse(check(f'{self.wt}/.git'))
        self.assertFalse(dv.menu_verdict(screen('Writing', '.git', self.cwd), self.cwd, self.common)[0])

    def test_home_and_main_checkout(self):
        self.assertFalse(self.verdict('Editing', '~/.bashrc', os.path.expanduser('~'))[0])
        self.assertFalse(self.verdict('Writing', f'{self.repo}/a.txt', str(self.repo))[0])

    def test_allow_dir_must_be_target_dir(self):
        self.assertFalse(self.verdict('Writing', 'src/a.ts', self.cwd)[0])
        no_allow = [l for l in screen('Writing', 'b.txt', self.cwd) if 'allow edits in' not in l]
        self.assertFalse(dv.menu_verdict(no_allow, self.cwd, self.common)[0])

    def test_wrapped_header(self):
        lines = screen('Writing', f'{self.cwd}/', f'{self.cwd}/')
        lines.insert(1, '  ../../etc/evil.txt')
        ok, why = dv.menu_verdict(lines, self.cwd, self.common)
        self.assertFalse(ok)
        self.assertIn('single-line', why)

    def test_unreadable_menus(self):
        no_header = [l for l in screen('Writing', 'b.txt', self.cwd) if 'Writing' not in l]
        self.assertFalse(dv.menu_verdict(no_header, self.cwd, self.common)[0])
        self.assertFalse(self.verdict('Writing', 'src/very/long/…/b.txt', self.cwd)[0])

    def test_latest_header_wins(self):
        lines = screen('Writing', 'b.txt', self.cwd)
        lines = ['⏺ Writing old.txt', *lines[:1], '⏺ Writing /etc/passwd', *lines[1:]]
        self.assertFalse(dv.menu_verdict(lines, self.cwd, self.common)[0])

    def test_no_option_number(self):
        lines = screen('Writing', 'b.txt', self.cwd)
        self.assertEqual([m.group(1) for l in lines if (m := dv.NO_OPTION.match(l))], ['4'])


if __name__ == '__main__':
    unittest.main()
