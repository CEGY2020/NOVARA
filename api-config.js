/* NOVARA API base URL.
 *
 * Empty string = same-origin (/api/...), used with local server.py or Amplify
 * reverse-proxy rewrites.
 *
 * Amplify builds and scripts/deploy_novara_api.py overwrite this file with the
 * deployed HTTP API / Function URL so GitHub Pages and Amplify both get JSON
 * even when /api/* is not proxied.
 */
window.NOVARA_API_BASE = window.NOVARA_API_BASE || "";
