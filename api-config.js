/* NOVARA API base URL.
 *
 * Empty string = same-origin (/api/...), used with local server.py or Amplify
 * reverse-proxy rewrites.
 *
 * Amplify builds and scripts/deploy_novara_api.py may overwrite this file in
 * the build artifact with the deployed HTTP API / Function URL. Prefer leaving
 * this committed copy empty so region-specific URLs are not stored in git.
 */
window.NOVARA_API_BASE = window.NOVARA_API_BASE || "";
