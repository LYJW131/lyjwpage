# python3 -I tests/test_menu.py — screen states, approval-menu parsing and scope checks on fixed screens.
# The screens follow the menu lyjw captured from Devin CLI v3000.11.92 --sandbox:
# a "⏺ Writing <path>" header, then 1 Approve once / 2 allow edits in <dir> / 3 always / 4 No.
import calendar, importlib.util, os, shutil, subprocess, tempfile, types, unittest
from pathlib import Path
from unittest import mock

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
        self.common = subprocess.run(
            ['git', '-C', str(self.wt), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
            capture_output=True, text=True, check=True).stdout.strip()
        (self.tmp / 'outside').mkdir()
        os.symlink(self.tmp / 'outside', self.wt / 'link')

    def verdict(self, tool, path, d):
        return dv.menu_verdict(screen(tool, path, d), self.cwd)

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

    def test_git_common_dir_is_never_writable(self):
        common = os.path.realpath(self.common)
        for rel in ('worktrees/wt/commondir', 'worktrees/wt/gitdir', 'worktrees/wt/index', 'objects/info/alternates',
                    'packed-refs', 'refs/heads/x', 'HEAD', 'config.worktrees', 'shallow', 'MERGE_HEAD',
                    'hooks/pre-commit', 'config'):
            with self.subTest(rel=rel):
                self.assertFalse(self.verdict('Writing', f'{common}/{rel}', os.path.dirname(f'{common}/{rel}'))[0])
                self.assertFalse(self.verdict('Writing', f'{common}/{rel}', self.cwd)[0])

    def test_plain_checkout_git_dir(self):
        cwd = str(self.repo)
        check = lambda p: dv.menu_verdict(screen('Writing', p, os.path.dirname(f'{cwd}/{p}')), cwd)[0]
        self.assertTrue(check('src/a.ts'))
        self.assertTrue(check('.gitignore'))
        for p in ('.git/refs/heads/x', '.git/hooks/pre-commit', '.git/config', '.git/HEAD', '.git', f'{self.wt}/.git'):
            with self.subTest(path=p):
                self.assertFalse(check(p))
        self.assertFalse(dv.menu_verdict(screen('Writing', '.git', self.cwd), self.cwd)[0])

    def test_home_and_main_checkout(self):
        self.assertFalse(self.verdict('Editing', '~/.bashrc', os.path.expanduser('~'))[0])
        self.assertFalse(self.verdict('Writing', f'{self.repo}/a.txt', str(self.repo))[0])

    def test_allow_dir_must_be_target_dir_or_worktree(self):
        self.assertTrue(self.verdict('Writing', 'src/a.ts', self.cwd)[0])
        self.assertTrue(self.verdict('Editing', 'src/deep/a.ts', f'{self.cwd}/src/deep')[0])
        self.assertFalse(self.verdict('Writing', 'src/deep/a.ts', f'{self.cwd}/src')[0])
        self.assertFalse(self.verdict('Writing', 'src/a.ts', f'{self.cwd}/other')[0])
        no_allow = [l for l in screen('Writing', 'b.txt', self.cwd) if 'allow edits in' not in l]
        self.assertFalse(dv.menu_verdict(no_allow, self.cwd)[0])

    def test_wrapped_header(self):
        lines = screen('Writing', f'{self.cwd}/', f'{self.cwd}/')
        lines.insert(1, '  ../../etc/evil.txt')
        ok, why = dv.menu_verdict(lines, self.cwd)
        self.assertFalse(ok)
        self.assertIn('single-line', why)

    def test_wrapped_allow_dir(self):
        lines = screen('Writing', f'{self.cwd}/sub/../../etc/evil.txt'[:len(self.cwd) + 4], self.cwd)
        i = next(i for i, l in enumerate(lines) if 'allow edits in' in l)
        lines.insert(i + 1, '     /sub/../../etc')
        self.assertFalse(dv.menu_verdict(lines, self.cwd)[0])

    def test_unreadable_menus(self):
        no_header = [l for l in screen('Writing', 'b.txt', self.cwd) if 'Writing' not in l]
        self.assertFalse(dv.menu_verdict(no_header, self.cwd)[0])
        self.assertFalse(self.verdict('Writing', 'src/very/long/…/b.txt', self.cwd)[0])

    def test_latest_header_wins(self):
        lines = screen('Writing', 'b.txt', self.cwd)
        lines = ['⏺ Writing old.txt', *lines[:1], '⏺ Writing /etc/passwd', *lines[1:]]
        self.assertFalse(dv.menu_verdict(lines, self.cwd)[0])

    def test_no_option_number(self):
        lines = screen('Writing', 'b.txt', self.cwd)
        self.assertEqual([m.group(1) for l in lines if (m := dv.NO_OPTION.match(l))], ['4'])


# Screens captured from Devin CLI v3000.11.92 in the cloud container (rules shortened).
RULE = '─' * 40
COMPOSER = lambda text: [RULE + ' (autonomous) ─', f'❭ {text}', RULE, 'SWE-2 Max']
BUSY = [' ⏺ Ran command', '⡤⠀ Thinking · 1s (esc twice to interrupt)', *COMPOSER('Guide Devin while it works')]
IDLE = [' DONE', *COMPOSER('Ask Devin to build features, fix bugs, or work on your code')]
OPEN_MENU = [' ⏺ Writing ./b.txt', ' └ 1 +  OK', '❭ 1 Yes  (Approve once)',
             '  2 Yes, allow edits in /wt', '  3 Yes, always allow edits in /wt', '  4 No',
             '↑↓ select · ↵ confirm · esc cancel']
LIMIT = [' ▲ Something went wrong',
         '   Reached free model rate limit. Upgrade to Max for higher limits, or switch to a different model. '
         'Your limit will reset in 1 hour 2 minutes (at 06:01 UTC). (trace ID: x). Send a message to retry']
QUOTA = [' ▲ Quota exhausted', '   Your daily usage quota has been exhausted. Switch to a GPT model to keep working.']


class ScreenState(unittest.TestCase):
    def test_basic_states(self):
        self.assertEqual(dv.classify(BUSY), 'busy')
        self.assertEqual(dv.classify(IDLE), 'idle')
        self.assertEqual(dv.classify(OPEN_MENU), 'approval')
        self.assertEqual(dv.classify([' DONE', *COMPOSER('half-pasted text')]), 'typed')

    def test_open_menu_beats_marker_text_in_its_preview(self):
        spoof = [' │ Ask Devin to build features', ' │ esc twice to interrupt', ' │ ' + RULE]
        self.assertEqual(dv.classify(IDLE + spoof + OPEN_MENU), 'approval')
        self.assertEqual(dv.classify(BUSY + OPEN_MENU), 'approval')

    def test_open_menu_beats_markers_anywhere(self):
        rule = '─' * 40
        for screen_ in (BUSY + IDLE + OPEN_MENU, [' │ Ask Devin to build features'] + OPEN_MENU,
                        [' │ ' + rule, ' │ esc twice to interrupt'] + BUSY[:2] + OPEN_MENU):
            self.assertEqual(dv.classify(screen_), 'approval')

    def test_answered_menu_in_scrollback(self):
        self.assertEqual(dv.classify(OPEN_MENU + IDLE), 'idle')
        self.assertEqual(dv.classify(OPEN_MENU + BUSY), 'busy')

    def test_marker_text_above_composer_is_ignored(self):
        self.assertEqual(dv.classify([' │ esc twice to interrupt', ' ⏺ Read a.py', *IDLE]), 'idle')

    def test_limit_screens(self):
        self.assertEqual(dv.classify(LIMIT + COMPOSER('Ask Devin to build features')), 'ratelimit')
        self.assertEqual(dv.classify(QUOTA + COMPOSER('Ask Devin to build features')), 'quota')
        self.assertEqual(dv.classify(LIMIT + BUSY), 'busy')
        self.assertEqual(dv.classify(LIMIT + IDLE), 'idle')

    def test_reset_wait(self):
        at = lambda h, m: calendar.timegm((2026, 10, 21, h, m, 0))
        self.assertEqual(dv.reset_wait(LIMIT, at(5, 0)), 3660)
        self.assertEqual(dv.reset_wait(LIMIT, at(6, 2)), -60)
        late = [l.replace('06:01', '00:10') for l in LIMIT]
        self.assertEqual(dv.reset_wait(late, at(23, 50)), 1200)
        self.assertIsNone(dv.reset_wait(IDLE))


class SendGuard(unittest.TestCase):
    def run_send(self, screens, text=None):
        # Entry check reads screens[0]; each Enter is preceded by a fresh read of the next one.
        seq, keys = iter(screens), []
        last = screens[-1]
        sh = lambda *a, **k: keys.append(a[1]) or types.SimpleNamespace(returncode=0, stdout='', stderr='')
        meta = dict(name='n', tmux='dv-n', cwd='/wt')
        patches = [mock.patch.object(dv, 'sh', sh), mock.patch.object(dv.subprocess, 'run'),
                   mock.patch.object(dv.time, 'sleep'), mock.patch.object(dv, 'save'),
                   mock.patch.object(dv, 'load', return_value=meta),
                   mock.patch.object(dv, 'tmux_alive', return_value=True),
                   mock.patch.object(dv, 'pane_dead', return_value=False),
                   mock.patch.object(dv, 'screen', lambda s, history=0: next(seq, last))]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        a = types.SimpleNamespace(name='n', text=[text or 'hello'], file=None)
        code = None
        try:
            dv.cmd_send(a)
        except SystemExit as e:
            code = e.code
        return code, keys.count('send-keys')

    def test_refuses_menu_and_question_at_entry(self):
        for scr in (OPEN_MENU, BUSY + OPEN_MENU, [' Which option?', '  1. a', '  2. b']):
            self.assertEqual(self.run_send([scr]), (4, 0))

    def test_menu_opening_before_enter_gets_no_enter(self):
        self.assertEqual(self.run_send([IDLE, OPEN_MENU]), (4, 0))
        self.assertEqual(self.run_send([BUSY, BUSY + OPEN_MENU]), (4, 0))

    def test_composer_gone_before_enter_gets_no_enter(self):
        self.assertEqual(self.run_send([IDLE, [' something else entirely']]), (4, 0))

    def test_second_enter_is_rechecked_too(self):
        stuck = [' DONE', *COMPOSER('hello')]
        self.assertEqual(self.run_send([IDLE, stuck, stuck, OPEN_MENU]), (4, 1))

    def test_normal_send_presses_enter(self):
        self.assertEqual(self.run_send([IDLE, [' DONE', *COMPOSER('hello')], IDLE]), (None, 1))
        self.assertEqual(self.run_send([BUSY, [*BUSY[:2], *COMPOSER('hello')], BUSY]), (None, 1))


if __name__ == '__main__':
    unittest.main()
