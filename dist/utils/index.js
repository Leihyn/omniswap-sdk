"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSwapId = generateSwapId;
exports.generateSecret = generateSecret;
exports.hashSecret = hashSecret;
exports.sleep = sleep;
exports.formatAmount = formatAmount;
exports.parseAmount = parseAmount;
exports.calculateSlippage = calculateSlippage;
exports.isValidAddress = isValidAddress;
exports.truncateAddress = truncateAddress;
exports.retry = retry;
const crypto_1 = require("crypto");
function generateSwapId() {
    return `swap_${Date.now()}_${(0, crypto_1.randomBytes)(8).toString('hex')}`;
}
function generateSecret() {
    return (0, crypto_1.randomBytes)(32);
}
function hashSecret(secret) {
    return (0, crypto_1.createHash)('sha256').update(secret).digest();
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function formatAmount(amount, decimals) {
    const str = amount.toString().padStart(decimals + 1, '0');
    const intPart = str.slice(0, -decimals) || '0';
    const decPart = str.slice(-decimals);
    return `${intPart}.${decPart}`;
}
function parseAmount(amount, decimals) {
    const [intPart, decPart = ''] = amount.split('.');
    const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(intPart + paddedDec);
}
function calculateSlippage(expected, actual) {
    if (expected === BigInt(0))
        return 0;
    return Number(expected - actual) / Number(expected);
}
function isValidAddress(chain, address) {
    switch (chain) {
        case 'zcash':
            return address.startsWith('t1') || address.startsWith('t3') || address.startsWith('zs');
        case 'osmosis':
            return address.startsWith('osmo1');
        case 'fhenix':
        case 'aztec':
            return /^0x[a-fA-F0-9]{40}$/.test(address);
        case 'mina':
            return address.startsWith('B62');
        default:
            return true;
    }
}
function truncateAddress(address, chars = 4) {
    if (address.length <= chars * 2 + 3)
        return address;
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
function retry(fn, maxRetries, delayMs = 1000) {
    return new Promise(async (resolve, reject) => {
        let lastError;
        for (let i = 0; i <= maxRetries; i++) {
            try {
                const result = await fn();
                return resolve(result);
            }
            catch (error) {
                lastError = error;
                if (i < maxRetries) {
                    await sleep(delayMs * Math.pow(2, i));
                }
            }
        }
        reject(lastError);
    });
}
//# sourceMappingURL=index.js.map