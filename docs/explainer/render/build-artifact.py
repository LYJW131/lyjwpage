# 从 index.html 生成发布版：去掉 doctype/html/head/body 外壳，保留 <title>、<style> 和正文
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
title = re.search(r"<title>.*?</title>", s, re.S).group(0)
style = re.search(r"<style>.*?</style>", s, re.S).group(0)
body = re.search(r"<body>(.*)</body>", s, re.S).group(1)
open(dst, "w", encoding="utf-8").write(title + "\n" + style + "\n" + body.strip() + "\n")
print("wrote", dst, len(title + style + body))
