# Geist Mono 字体分片

`GeistMono-LatinUi-Variable.woff2` 来自安装的 `geist` 包中的 `dist/fonts/geist-mono/GeistMono-Variable.woff2`，许可与版权见 [OFL.txt](./OFL.txt)。保留原字体的可变字重、hinting 与布局特性，不替换字体族。

预加载分片包含 Latin、生产源码使用的字符，以及原字体支持的数学、箭头、键盘与数字符号；组合附加符号整块保留，并保留原字体中规范分解结果完全由这些字符组成的预组字符，避免字体分片改变组合标记的定位或整形时的重组结果。字符选择不随歌曲或实时数据变化。[theme.css](../../app/styles/theme.css) 的两条 `unicode-range` 按原字体 cmap 划分：子集负责界面字符，完整字体负责其余受支持字符，范围互不重叠。原字体没有的字符仍走系统回退。

根布局只预加载子集；CSS URL 相对 `src/app/site.css` 解析。升级 `geist` 或调整字符范围时，同步更新字体资产、两个范围与预加载引用。

## 生成

在仓库根目录执行。工具只安装到临时 venv，不进入项目依赖或构建：

```sh
font_tools_dir=$(mktemp -d)
python3 -m venv "$font_tools_dir"
"$font_tools_dir/bin/pip" install 'fonttools[woff]' uharfbuzz
font_subset_ranges=$(python3 -c 'import pathlib,re; print(re.search(r"unicode-range:\s*([^;]+)", pathlib.Path("src/app/styles/theme.css").read_text())[1])')
"$font_tools_dir/bin/pyftsubset" \
  node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2 \
  --output-file=src/assets/fonts/GeistMono-LatinUi-Variable.woff2 \
  --flavor=woff2 --unicodes="$font_subset_ranges" \
  --layout-features='*' --name-IDs='*' --name-legacy --name-languages='*' \
  --glyph-names --notdef-glyph --notdef-outline --recommended-glyphs \
  --no-harfbuzz-repacker
cp node_modules/geist/LICENSE.txt src/assets/fonts/OFL.txt
```

## 验证

保留上面的 `font_tools_dir`，比较 cmap 分区、规范分解闭包、字体度量、可变轴、各字重的轮廓与字宽，并用 HarfBuzz 对照组合字符的默认整形结果：

```sh
"$font_tools_dir/bin/python" - <<'PY'
import pathlib, re, unicodedata
from io import BytesIO
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

original = TTFont("node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2")
subset = TTFont("src/assets/fonts/GeistMono-LatinUi-Variable.woff2")
cmap, selected = original.getBestCmap(), subset.getBestCmap()
assert all(cmap[code] == glyph for code, glyph in selected.items())
ranges = []
for face in re.findall(r"unicode-range:\s*([^;]+)", pathlib.Path("src/app/styles/theme.css").read_text()):
    points = set()
    for entry in face.split(","):
        bounds = [int(part, 16) for part in entry.strip().removeprefix("U+").split("-")]
        points.update(range(bounds[0], bounds[-1] + 1))
    ranges.append(points)
assert ranges == [set(selected), set(cmap) - set(selected)]
assert {code for code in cmap if 0x0300 <= code <= 0x036F} <= set(selected)
assert all(code in selected for code in cmap
           if set(map(ord, unicodedata.normalize("NFD", chr(code)))) <= set(selected))
assert "GSUB" in subset and "gvar" in subset
for table, fields in {
    "head": ["unitsPerEm"],
    "hhea": ["ascent", "descent", "lineGap", "caretSlopeRise", "caretSlopeRun", "caretOffset"],
    "OS/2": ["sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent", "sxHeight", "sCapHeight"],
}.items():
    assert all(getattr(original[table], field) == getattr(subset[table], field) for field in fields)
axes = lambda font: [(a.axisTag, a.minValue, a.defaultValue, a.maxValue, a.flags) for a in font["fvar"].axes]
assert axes(original) == axes(subset)
locations = [instance.coordinates for instance in original["fvar"].instances]
locations += [{axis.axisTag: value} for axis in original["fvar"].axes for value in (axis.minValue, axis.defaultValue, axis.maxValue)]
for location in locations:
    before, after = original.getGlyphSet(location=location), subset.getGlyphSet(location=location)
    for glyph in subset.getGlyphOrder():
        assert original["hmtx"].metrics[glyph] == subset["hmtx"].metrics[glyph]
        first, second = DecomposingRecordingPen(before), DecomposingRecordingPen(after)
        before[glyph].draw(first)
        after[glyph].draw(second)
        assert first.value == second.value and before[glyph].width == after[glyph].width
def shaping_font(font):
    font.flavor = None
    data = BytesIO()
    font.save(data)
    face = hb.Face(data.getvalue())
    result = hb.Font(face)
    result.scale = (face.upem, face.upem)
    return result, font.getGlyphOrder()

def shape(font, glyphs, text, location):
    font.set_variations(location)
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(font, buffer)
    return [(glyphs[info.codepoint], info.cluster, pos.x_advance, pos.y_advance,
             pos.x_offset, pos.y_offset)
            for info, pos in zip(buffer.glyph_infos, buffer.glyph_positions)]

before_font, before_glyphs = shaping_font(original)
after_font, after_glyphs = shaping_font(subset)
samples = {unicodedata.normalize("NFD", chr(code)) for code in selected}
samples.add("A\u0301 e\u0308 n\u0303 a\u0323\u0302")
for location in locations:
    for text in samples:
        assert shape(before_font, before_glyphs, text, location) == shape(after_font, after_glyphs, text, location), (text, location)
print("Font coverage, metrics, outlines, advance widths and canonical shaping match.")
PY
rm -r "$font_tools_dir"
```

构建后在浏览器核对预加载 URL 与子集 face 相同；英文界面、中文正文、`↗①` 及 `Á ë ñ ậ` 不请求完整字体，互补范围内的 Cyrillic 字符仍能按需请求完整字体。对照截图检查字重、斜杠零、数字宽度、组合标记定位和布局。
