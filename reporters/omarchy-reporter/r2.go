package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// r2Bucket writes app icons to the site's image bucket with a key that may
// only write that bucket, as reporters/emby-reporter/src/r2.ts does.
type r2Bucket struct {
	endpoint, bucket, accessKeyID, secretAccessKey string
	client                                         *http.Client
}

func (c config) bucket() *r2Bucket {
	if c.r2Endpoint == "" || c.r2Bucket == "" || c.r2AccessKeyID == "" || c.r2SecretAccessKey == "" {
		return nil
	}
	return &r2Bucket{
		endpoint: strings.TrimRight(c.r2Endpoint, "/"), bucket: c.r2Bucket,
		accessKeyID: c.r2AccessKeyID, secretAccessKey: c.r2SecretAccessKey,
		client: &http.Client{},
	}
}

func hashHex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, s string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(s))
	return m.Sum(nil)
}

func (b *r2Bucket) objectURL(key string) (*url.URL, error) {
	return url.Parse(b.endpoint + "/" + url.PathEscape(b.bucket) + "/" + url.PathEscape(key))
}

// do sends a SigV4-signed request; extra headers are signed too.
func (b *r2Bucket) do(ctx context.Context, method, key string, body []byte, extra map[string]string) (*http.Response, error) {
	u, err := b.objectURL(key)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	shortDate := amzDate[:8]
	payloadHash := hashHex(body)
	headers := map[string]string{"host": u.Host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate}
	for k, v := range extra {
		headers[strings.ToLower(k)] = v
	}
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	slices.Sort(names)
	var canonical strings.Builder
	for _, k := range names {
		canonical.WriteString(k + ":" + headers[k] + "\n")
	}
	signed := strings.Join(names, ";")
	request := strings.Join([]string{method, u.EscapedPath(), "", canonical.String(), signed, payloadHash}, "\n")
	scope := shortDate + "/auto/s3/aws4_request"
	toSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, hashHex([]byte(request))}, "\n")
	key4 := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+b.secretAccessKey), shortDate), "auto"), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key4, toSign))

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		if k != "host" {
			req.Header.Set(k, v)
		}
	}
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", b.accessKeyID, scope, signed, signature))
	res, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	res.Body.Close()
	res.Body = io.NopCloser(bytes.NewReader(raw))
	return res, nil
}

// ensure uploads the icon unless the bucket already has it.
func (b *r2Bucket) ensure(ctx context.Context, icon *appIcon) error {
	key := icon.objectKey()
	if res, err := b.do(ctx, http.MethodHead, key, nil, nil); err == nil && res.StatusCode == http.StatusOK {
		return nil
	}
	res, err := b.do(ctx, http.MethodPut, key, icon.png, map[string]string{
		"content-type":  "image/png",
		"cache-control": "public, max-age=31536000, immutable",
	})
	if err != nil {
		return err
	}
	if res.StatusCode/100 != 2 {
		detail, _ := io.ReadAll(res.Body)
		return fmt.Errorf("R2 upload %d: %s", res.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}
