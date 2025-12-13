# M3U Site

This is a special site configuration for channels parsed from M3U playlists.

## Usage

Set the `M3U_URL` environment variable to automatically parse M3U playlists:

```bash
docker run -e M3U_URL=https://example.com/playlist.m3u ghcr.io/iptv-org/epg:master
```

## Note

M3U files typically don't contain EPG (Electronic Program Guide) data. This site config is a placeholder that allows M3U channels to be processed, but it won't fetch program information unless the M3U playlist URLs point to sources that provide EPG data via their own APIs.

For best results, use M3U playlists that include `tvg-id` attributes matching channels in the iptv-org database, which will allow proper EPG data matching.
