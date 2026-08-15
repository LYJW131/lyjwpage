# @lyjwpage/am-motion-artwork

Cloudflare Worker 代理服务：用于解析 Apple Music 专辑与单曲的 1:1 正方形动态封面（`motionDetailSquare`）视频及背景主题色调板。

## 部署信息
- **自定义域名**：`https://am-motion-artwork.homepage.lyjw.llc`
- **默认域名**：`https://am-motion-artwork.2927761562.workers.dev`

## 接口说明
- **请求方式**：`GET`
- **入参**：`url`（需要提取动态封面的 Apple Music 链接）
- **缓存策略**：使用 Cloudflare Cache API 与边缘 CDN 缓存，成功结果缓存 24 小时，未命中结果缓存 1 小时。

### 请求示例
```bash
curl "https://am-motion-artwork.homepage.lyjw.llc/?url=https%3A%2F%2Fmusic.apple.com%2Fus%2Falbum%2Fpositions%2F1538081237"
```

### 返回格式
```json
{
  "hasMotion": true,
  "videoUrl": "https://video-ssl.itunes.apple.com/...",
  "colors": ["18171f", "fcfcfc", "aba7ae", "95929a", "6c6771"]
}
```

## 开发与部署
```bash
# 本地调试
pnpm --filter @lyjwpage/am-motion-artwork dev

# 部署上线
pnpm --filter @lyjwpage/am-motion-artwork run deploy
```
