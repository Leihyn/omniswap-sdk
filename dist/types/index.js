"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTLCState = exports.ExecutionState = exports.IntentStatus = exports.SwapMechanism = exports.PrivacyLevel = exports.Chain = void 0;
// Core enums
var Chain;
(function (Chain) {
    Chain["ZCASH"] = "zcash";
    Chain["MIDEN"] = "miden";
    Chain["AZTEC"] = "aztec";
    Chain["MINA"] = "mina";
    Chain["FHENIX"] = "fhenix";
    Chain["OSMOSIS"] = "osmosis";
})(Chain || (exports.Chain = Chain = {}));
var PrivacyLevel;
(function (PrivacyLevel) {
    PrivacyLevel["STANDARD"] = "standard";
    PrivacyLevel["ENHANCED"] = "enhanced";
    PrivacyLevel["MAXIMUM"] = "maximum";
})(PrivacyLevel || (exports.PrivacyLevel = PrivacyLevel = {}));
var SwapMechanism;
(function (SwapMechanism) {
    SwapMechanism["ATOMIC_SWAP"] = "atomic-swap";
    SwapMechanism["AMM_SWAP"] = "amm-swap";
    SwapMechanism["IBC_TRANSFER"] = "ibc-transfer";
    SwapMechanism["BRIDGE"] = "bridge";
    SwapMechanism["SOLVER_FILL"] = "solver-fill";
})(SwapMechanism || (exports.SwapMechanism = SwapMechanism = {}));
var IntentStatus;
(function (IntentStatus) {
    IntentStatus["PENDING"] = "pending";
    IntentStatus["MATCHED"] = "matched";
    IntentStatus["EXECUTING"] = "executing";
    IntentStatus["COMPLETED"] = "completed";
    IntentStatus["FAILED"] = "failed";
    IntentStatus["EXPIRED"] = "expired";
    IntentStatus["CANCELLED"] = "cancelled";
})(IntentStatus || (exports.IntentStatus = IntentStatus = {}));
var ExecutionState;
(function (ExecutionState) {
    ExecutionState["INITIALIZING"] = "initializing";
    ExecutionState["LOCKING_SOURCE"] = "locking_source";
    ExecutionState["CONFIRMING_LOCK"] = "confirming_lock";
    ExecutionState["RELEASING_DEST"] = "releasing_dest";
    ExecutionState["CONFIRMING_RELEASE"] = "confirming_release";
    ExecutionState["COMPLETING"] = "completing";
    ExecutionState["COMPLETED"] = "completed";
    ExecutionState["REFUNDING"] = "refunding";
    ExecutionState["REFUNDED"] = "refunded";
    ExecutionState["FAILED"] = "failed";
})(ExecutionState || (exports.ExecutionState = ExecutionState = {}));
var HTLCState;
(function (HTLCState) {
    HTLCState["PENDING"] = "pending";
    HTLCState["LOCKED"] = "locked";
    HTLCState["CLAIMED"] = "claimed";
    HTLCState["REFUNDED"] = "refunded";
    HTLCState["EXPIRED"] = "expired";
})(HTLCState || (exports.HTLCState = HTLCState = {}));
//# sourceMappingURL=index.js.map