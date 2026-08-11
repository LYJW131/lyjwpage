import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["test.lyjw.dev"],
  images: {
    /**
     * 只放行自建歌单封面这一个来源。
     *
     * 那些封面是 Apple 直接给的**原图**（实测 274KB PNG，没有 {w}x{h} 尺寸
     * 参数可填），而页面上那格只有 80px —— 全站唯一一处需要站点这侧缩放的图。
     * 其余图片一律不走优化器：R2 上的已经是压好的最终尺寸且 immutable，
     * mzstatic 的公开封面自带尺寸模板，再转一道是纯浪费。
     *
     * host 用通配是因为 Apple 把这些图散在 store-030 ~ store-037 好几台上。
     *
     * pathname 只能写 `/**`：`**` 匹配的是完整路径段，段内通配（写成
     * `/sq-mq-**` 想框住那批桶）不成立 —— 拿 next 自己的 matchRemotePattern
     * 对真实地址试过，返回 false，线上表现是「"url" parameter is not allowed」。
     *
     * 已知折扣：`search` 也锁不死。预签名地址必须带 X-Amz-* 参数，而按文档
     * 省略 search 等于放行任意查询串。合起来的风险是别人能拿这条规则转码
     * 同一批 Apple 存储桶里的图 —— 范围仅限这个 host，可以接受。
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.blobstore.apple.com",
        pathname: "/**",
      },
    ],
    /**
     * 仅供「自建部署 + 本机走 fake-IP 代理」这一种情况。
     *
     * Clash/Surge 那类代理在 TUN 模式下把域名解析到 198.18.0.0/15，而 Next 16
     * 的 SSRF 防护看到私有 IP 就拒绝取图（实测：hostname resolved to private
     * IP 198.18.8.12，连问 1.1.1.1 都是这个结果，是网络层劫持不是本机 DNS）。
     *
     * 默认关，Vercel 上不要设 —— 那边解析得到真实公网 IP，开了纯属白白削弱
     * SSRF 防护。真正干净的解法是在代理里给 blobstore.apple.com 配直连规则，
     * 这个开关只是不想让部署被代理配置卡住。
     */
    dangerouslyAllowLocalIP: process.env.IMAGE_ALLOW_LOCAL_IP === "true",
  },
};

export default nextConfig;
