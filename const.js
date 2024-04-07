const protocol_address = "";
const token_address = "";
const uvuln_address = "";
const vvuln_address = "";
const RPC_ADDRESS = "https://api.testnet.solana.com"
const MYSQL_HOST = "localhost"
const MYSQL_USER = "root"
const MYSQL_PASSWORD = "123"
const MYSQL_DB = "gecko"
const URL_SUFFIX = "geckofuzz.com"

module.exports = {
    protocol_address,
    token_address,
    uvuln_address,
    vvuln_address,
    RPC_ADDRESS,
    MYSQL_HOST,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DB,
    STATS_API_URL: `https://stats-api.${URL_SUFFIX}`,
    IPFS_GW_API: `https://ipfs.${URL_SUFFIX}`,
    PRICE_ESTIMATOR: `https://pricing-api.${URL_SUFFIX}`,
    TELEMETRY_API: `34.69.22.45:50051`,
    MAX_PER_FETCH: 3000,
    START_FETCH_BLOCK: 28560000
}