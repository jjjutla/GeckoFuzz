import * as solanaWeb3 from '@solana/web3.js';
import * as fs from "fs";
import * as prompt from "prompt-sync";
import * as os from "os";

// Initialize Solana connection
const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));


let violations: {address: string, amount: string, txn: string} | undefined = undefined;

type FuzzContext = {
    methods: {
        hash: string,
    }[]
}

type ContractInfo = {
    Code: Buffer,
    DeployedAddress: Address,
    Ctx?: FuzzContext
}

type corpus_t = {
    ContractAddress: string,
    Data: Buffer,
    State: EEI,
}[]


const string_to_address = (address: string) : Address => {
    if (address.slice(0, 2) === "0x") {
        address = address.slice(2);
    }
    return new Address(Buffer.from(address, "hex"))
}

const address_to_string = (address: Address) : string => {
    return address.toBuffer().toString("hex");
}

let method_lengths = {};
let current_hash: string | undefined = undefined
const dummy_buffer = Buffer.alloc(200, 0);
let debug_current_txn : Buffer | undefined = undefined;

const read_memory = (memory: Buffer, offset: number, size: number) => {
    const returnBuffer = Buffer.allocUnsafe(size)
    const loaded = Buffer.from(memory.slice(offset, offset + size))
    returnBuffer.fill(loaded, 0, loaded.length)
    if (loaded.length < size) {
        returnBuffer.fill(0, loaded.length, size)
    }
    return returnBuffer
}

const run_transaction = async (
    address: Address,
    data: Buffer,
    eei: EEI,
    contract_addr: string,
    with_dummy: boolean = true) : Promise<{dag: dag_t, reverted: boolean}> => {

    debug_current_txn = data;

    let inside_contract = 0;

    await eei.checkpoint()
    const evm = await get_EVM(eei, [
        (data) => {
            // console.log(debug_current_txn?.toString("hex"))

            if (data.opcode.name === "CALLDATALOAD" && inside_contract === 0) {

                const offset = data.stack[data.stack.length - 1];
                console.assert(current_hash !== undefined, "current_hash is undefined", debug_current_txn?.toString("hex"))
                if (current_hash && (method_lengths[current_hash] === undefined
                    || method_lengths[current_hash] < (offset + BigInt(32)))) {
                    method_lengths[current_hash] = Number(offset) + 32;
                    debug_log(method_lengths)
                }
            }

            if (["CALL", "CALLCODE","STATICCALL", "DELEGATECALL"].includes(data.opcode.name)) {
                inside_contract++;
                let offset = BigInt(0), size  = BigInt(0);
                if (["STATICCALL", "DELEGATECALL"].includes(data.opcode.name)) {
                    offset = data.stack[data.stack.length - 3];
                    size = data.stack[data.stack.length - 4];
                } else {
                    offset = data.stack[data.stack.length - 4];
                    size = data.stack[data.stack.length - 5];
                }
                const input = read_memory(data.memory, Number(offset), Number(size));

                if (input.length >= 4 && input.slice(0, 4).toString("hex") === "a9059cbb") {
                    const parsed = web3.eth.abi.decodeParameters(["address", "uint256"], input.subarray(4).toString("hex"));
                    const parsed_result = {
                        address: String(parsed['0']),
                        amount: String(parsed['1']),
                        txn: String(debug_current_txn?.toString("hex"))
                    }
                    if (parsed_result.amount !== "0") {
                        violations = parsed_result;
                        debug_log(parsed_result)
                    }
                }
            }
            if (data.opcode.name === "RETURN") inside_contract--;
        }
    ]);
    reset_shared_dag();

    current_hash = data.subarray(0, 4).toString("hex")

    const p : Promise<boolean> = new Promise(async (resolve, reject) => {
        await evm
            .runCode({
                code: await get_function_code(contract_addr),
                // expand to avoid CALLDATASIZE reverts
                data: with_dummy ? Buffer.concat([data, dummy_buffer]) : data,
                gasLimit: BigInt(100000000000000000000),
                caller: address,
                address: string_to_address(contract_addr),
            })
            .then((results) => {
                if (results.exceptionError !== undefined) {
                    eei.revert();
                }
                return resolve(results.exceptionError !== undefined)
            })
            .catch(v => {
                console.log(v);
                reject();
            })
    });
    const reverted = await p;
    return {reverted, dag: get_shared_dag()};
}

function randomInteger(min : number, max: number) : number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const get_bits = (name: string) : number => {
    name = name.replace(/[^0-9]/g, '');
    return parseInt(name);
}


type eei_queue_t = {
    eei: EEI
    priority: number
}[]

const serialize_transitions = (dag: dag_t) : string[] =>
    dag.map(v => {
        return v.src.toString() + ">" + v.dst.toString()
    })


class SMData {
    account: Account
    code: Buffer
    storage: Map<string, Buffer>

    constructor(account: undefined | Account) {
        if (!account) this.account = new Account();
        else this.account = account;

        this.code = Buffer.from([])
        this.storage = new Map()
    }

    clearContract(){
        this.storage.clear()
    }

    toJSON(): any {
        let serializedStorage: {[key: string]: string} = {}
        this.storage.forEach((v, k) => {
            serializedStorage[k] = v.toString("base64");
        })
        return {
            account: this.account.serialize().toString("base64"),
            code: this.code.toString("base64"),
            storage: serializedStorage
        }
    }


    fromJSON(input: any) {
        this.account = Account.fromRlpSerializedAccount(Buffer.from(input.account, "base64"))
        this.code = Buffer.from(input.code, "base64");
        this.storage = new Map();
        Object.keys(input.storage).map((k: any) => {
            this.storage.set(k, Buffer.from(input.storage[k], "base64"))
        });

    }
}

const address_ser = (address: Address) : string => {
    return address.toBuffer().toString("base64")
}
const address_der = (address: string) : Address => {
    return new Address(Buffer.from(address, "base64"))
}

class FuzzStateManager implements StateManager {
    knownAddress: Address[] = [];
    storage: Map<string, SMData> = new Map();
    ckpt: Map<string, SMData> = new Map();
    dirty: Set<string> = new Set();

    toJSON(): any {
        let serializedStorage: {[key: string]: string} = {} = {}
        this.storage.forEach((v, k) => {
            serializedStorage[k] = v.toJSON();
        })
        return {
            knownAddress: this.knownAddress.map(v => v.toBuffer().toString("hex")),
            storage: serializedStorage,
            dirty: Array.from(this.dirty)
        }
    }

    fromJSON(input: any) {
        this.knownAddress = []
        input.knownAddress?.forEach((v: string) => {
            this.knownAddress.push(new Address(Buffer.from(v, "hex")))
        })
        this.dirty = new Set(input.dirty)
        this.storage = new Map();
        Object.keys(input.storage).map((k: any) => {
            const sm = new SMData(undefined)
            sm.fromJSON(input.storage[k]);
            this.storage.set(k, sm)
        })
    }


    accountExists(address: Address): Promise<boolean> {
        console.log("accountExists")
        return Promise.resolve(
            this.knownAddress.map((a: Address) => a.equals(address)).reduce((a,b)=> a||b)
        )
    }

    accountIsEmpty(address: Address): Promise<boolean> {
        console.log("accountIsEmpty")
        return Promise.resolve(this.storage.has(address_ser(address)));
    }

    checkpoint(): Promise<void> {
        this.ckpt = this.toJSON();
        return Promise.resolve();
    }

    clearContractStorage(address: Address): Promise<void> {
        console.log("clearContractStorage")
        this.storage.get(address_ser(address))?.clearContract()
        return Promise.resolve();
    }

    commit(): Promise<void> {
        return Promise.resolve();
    }

    copy(): StateManager {
        const json = this.toJSON();
        const newObj = new FuzzStateManager();
        newObj.fromJSON(json)
        // @ts-ignore
        return newObj;
    }

    deleteAccount(address: Address): Promise<void> {
        console.log("address")

        this.storage.delete(address_ser(address));
        return Promise.resolve();

    }

    dumpStorage(address: Address): Promise<StorageDump> {
        console.log("undef dump")
        // @ts-ignore
        return Promise.resolve(undefined);
    }

    flush(): Promise<void> {
        // console.log("undef flush")
        // @ts-ignore
        return Promise.resolve(undefined);
    }

    getAccount(address: Address): Promise<Account> {
        // console.log("getAccount")
        // console.log("getAccount", address.toString())

        const store = this.storage.get(address_ser(address));
        if (store === undefined) {
            const store = new SMData(undefined)
            this.storage.set(address_ser(address), store);
            return Promise.resolve(store.account)
        }
        return Promise.resolve(store.account);
    }

    async getContractCode(address: Address): Promise<Buffer> {

        if (!this.dirty.has(`${address_ser(address)}_code`)) {
            const data = Buffer.from(await getCode(address_to_string(address)), "hex")
            await this.putContractCode(address, data)
            return Promise.resolve(data)
        }

        const store = this.storage.get(address_ser(address));
        if (store === undefined) return Promise.reject();
        return Promise.resolve(store.code);
    }

    async getContractStorage(address: Address, key: Buffer): Promise<Buffer> {
        // console.log(address, key)

        if (!this.dirty.has(`${address_ser(address)}-${key.toString("base64")}`)) {
            const data = Buffer.from(
                await getStorageAt(address_to_string(address), key.toString("hex")), "hex")
            await this.putContractStorage(address, key, data)
            return Promise.resolve(data)
        }

        const store = this.storage.get(address_ser(address));
        if (store === undefined) return Promise.resolve(Buffer.from([]));
        const content = store.storage.get(key.toString("base64"));
        if (content === undefined) return Promise.resolve(Buffer.from([]));

        return Promise.resolve(content);
    }

    getStateRoot(): Promise<Buffer> {
        console.log("undef getStateRoot")
        // @ts-ignore
        return Promise.resolve(undefined);
    }

    hasStateRoot(root: Buffer): Promise<boolean> {
        console.log("undef hasStateRoot")
        return Promise.resolve(false);
    }

    modifyAccountFields(address: Address, accountFields: AccountFields): Promise<void> {
        console.log("modifyAccountFields")

        const store = this.storage.get(address_ser(address));
        if (store === undefined) return Promise.reject();
        const account = store.account
        account.nonce = accountFields.nonce ?? account.nonce
        account.balance = accountFields.balance ?? account.balance
        account.storageRoot = accountFields.storageRoot ?? account.storageRoot
        account.codeHash = accountFields.codeHash ?? account.codeHash
        return Promise.resolve()
    }

    putAccount(address: Address, account: Account): Promise<void> {
        // console.log("putAccount")
        // console.trace("putAccount")
        // console.assert(false, "putAccount: " + debug_current_txn?.toString("hex"), address.toString(), account)

        this.storage.set(address_ser(address), new SMData(account));
        return Promise.resolve()
    }

    putContractCode(address: Address, value: Buffer): Promise<void> {
        // console.log("putContractCode")
        this.dirty.add(`${address_ser(address)}_code`)
        // @ts-ignore
        if (this.storage.has(address)) this.storage.get(address).code = value;
        else {
            const data = new SMData(undefined);
            data.code = value;
            this.storage.set(address_ser(address), data);
        }
        return Promise.resolve()
    }

    putContractStorage(address: Address, key: Buffer, value: Buffer): Promise<void> {
        this.dirty.add(`${address_ser(address)}-${key.toString("base64")}`);

        let store = this.storage.get(address_ser(address));
        if (store === undefined) {
            store = new SMData(undefined);
            this.storage.set(address_ser(address), store)
        }
        store.storage.set(key.toString("base64"), value);
        return Promise.resolve()
    }

    revert(): Promise<void> {
        this.fromJSON(this.ckpt);
        return Promise.resolve();
    }

    setStateRoot(stateRoot: Buffer): Promise<void> {
        console.log("undef stateroot")
        // @ts-ignore
        return Promise.resolve(undefined);
    }

}

type FuzzResult = {allFoundVulns: {[key: string]: string}, allFoundTestcases: string[]}
//
// const get_contract_info = async (contract_code: string, stateManager: StateManager) : Promise<{ contract_info_arr: ContractInfo, baseEEI: EEI, corpus: corpus_t }>=> {
//     const blockchain = await Blockchain.create()
//     const baseEEI = new EEI(stateManager, common, blockchain);
//     // set up corpus
//     let corpus: corpus_t = [];
//
//     // deploy contracts
//     let contract_info_arr: ContractInfo[] = [];
//
//     for (let i = 0; i < contracts.length; i++) {
//         const currentContract = contracts[i].prefix;
//         const info = await deploy_contract(
//             new Address(Buffer.from("0000000000000000000000000000000000000001", "hex")),
//             Buffer.from(fs.readFileSync(`${currentContract}.bin`).toString(), "hex"),
//             baseEEI
//         );
//         const abi = JSON.parse(fs.readFileSync(`${currentContract}.abi`).toString());
//         let {ctx, oracle} = parse_abi(abi);
//         info.Ctx = ctx;
//         info.Oracle = oracle;
//         info.Web3Instance = new web3.eth.Contract(abi);
//
//         contract_info_arr.push(info);
//
//         // init corpus
//         info.Ctx.methods.forEach(v => {
//             corpus.push({
//                 contract: info,
//                 method: v.name,
//                 args: v.abis,
//                 eei: baseEEI,
//                 idx: i
//             })
//         })
//     }
//
//     return {contract_info_arr, baseEEI, corpus}
// }

const contract_code_cache = {}

const get_function_code = async (address: string) : Promise<Buffer> => {
    if (contract_code_cache[address] === undefined) {
        console.log("fetching code from endpoint", address)
        let code = Buffer.from((await getCode(address)), "hex")
        contract_code_cache[address] = code
        return code
    }
    return contract_code_cache[address]
}

const to_address = (address: number) : Address => {
    const buf = Buffer.alloc(20, 0);
    Buffer.from(address.toString(16)).copy(buf);

    return new Address(buf)
}


const mutate = (data: Buffer) : Buffer => {
    const size = method_lengths[data.subarray(0, 4).toString("hex")] ?? 4;
    if (data.length != size) {
        data = Buffer.concat([data.subarray(0, 4), Buffer.alloc(size - 4, 0)]);
        // console.log(data.length, method_lengths)
    }
    const buf = Buffer.alloc(data.length, 0);
    data.copy(buf);
    const change_idx = 4 + Math.floor(Math.random() * (buf.length - 4));
    switch (Math.floor(Math.random() * 2)) {
        case 0:
            // replace
            buf[change_idx] = Math.floor(Math.random() * 256);
            break;
        case 1:
            for (let i = 0; i < 10; i++) {
                buf[4 + Math.floor(Math.random() * (buf.length - 4))] = Math.floor(Math.random() * 256);
            }
    }
    return buf;
}

const debug = false;

const debug_log = (...msg: any[]) => {
    if (debug) console.log(...msg)
}

const fuzz_loop = async (contract_address: string, length=300000) : Promise<FuzzResult> => {
    // let trie = new FuzzTrie({
    //   db: new FuzzDB(),
    //   useNodePruning: true
    // });
    const stateManager = new FuzzStateManager();

    let known_dags: string[][] = [];

    let all_functions: Buffer[] = extract_callable_funcs_from_bytecode(
        await get_function_code(contract_address));
    debug_log("funcs", all_functions.map(v => v.toString("hex")))

    const blockchain = await Blockchain.create()
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London });
    // init corpus
    let corpus: corpus_t = [];
    all_functions.forEach(v => {
        corpus.push({
            ContractAddress: contract_address,
            Data: v,
            State: new EEI(stateManager, common, blockchain),
        })
    })

    let exec = 0;
    let fuzzStart = Date.now();
    let iterStart = Date.now();
    let allFoundTestcases: string[]  = [];
    let allFoundVulns: {[key: string]: string} = {};
    const epoch_size =5000;
    let coverage_map: string[] = [];

    let potential = 0;
    let violations_cnt = 0;

    while (1) {
        exec += 1;
        if (exec % epoch_size === 0) {
            const current = Date.now();
            let elapsed = current - iterStart;
            if (length > 0 && current - fuzzStart > length) {
                break
            }
            debug_log(elapsed, epoch_size / elapsed * 1000, "exec / s - total", exec);
            iterStart = Date.now();
        }

        // select
        const current_item = corpus[randomInteger(0, corpus.length - 1)];
        const current_data = mutate(current_item.Data);

        // make a copy of eei
        const current_eei = current_item.State.copy();

        // run txn
        let caller = to_address(1);

        violations = undefined

        let {dag, reverted} = await run_transaction(
            caller,
            current_data,
            current_eei,
            contract_address
        )



        if (reverted) {
            // rerun first
            // const result = await run_transaction(
            //     caller,
            //     current_data,
            //     current_eei,
            //     contract_address,
            //     false
            // )
            // dag = result.dag;
            // reverted = result.reverted;
            if (violations && potential < 10) {
                potential++;
                const address = current_item.ContractAddress;
                fs.writeFileSync(`violations/potential-${address}-${randomInteger(0, 100000)}`, JSON.stringify({
                    violations,
                    address,
                }))
            }
            if (reverted) {
                continue
            }
        }
        // console.log("not reverted", debug_current_txn?.toString("hex"))
        if (violations !== undefined && violations_cnt < 10) {
            violations_cnt++;
            console.log("found violation", violations)
            const address = current_item.ContractAddress;
            fs.writeFileSync(`violations/${address}-${randomInteger(0, 100000)}`, JSON.stringify({
                violations,
                address,
            }))

            if (violations_cnt >= 10) {
                break
            }
        }


        // let {
        //     violated, oracle_name, dag
        // } = await run_oracles(caller, current_eei, current_item.contract, current_item.contract.Web3Instance);


        // check cov
        const serialized_transitions = serialize_transitions(dag);
        const cov_changed = serialized_transitions.map(v => {
            if (coverage_map.includes(v)) return false;
            coverage_map.push(v);
            return true;
        }).reduce((a,b) => a || b, false)

        // handle check

        if (cov_changed) {
            debug_log("new coverage", coverage_map.length)
            corpus.push({
                ContractAddress: contract_address,
                Data: current_data,
                State: current_eei,
            })
            debug_log("new coverage for :", JSON.stringify(dag))
            // allFoundTestcases.push(serialized_txn)
        }

        // eval past eei, evict if needed
        // eei_queue[selected_eei_index].priority *= 0.1;
        //
        // if (!current_eei.hasStateChange) {
        //   continue;
        // }
        // eei_queue.push({
        //   eei: current_eei, priority: 0
        // })
    }
    return {allFoundTestcases, allFoundVulns}
}

const BATCH_SIZE = 30;
async function hack(contracts: string[]) {
    let res: any[] = []
    while (contracts.length > 0){
        for (let i = 0; i < BATCH_SIZE; i++) {
            const current = contracts.pop();
            if (current === undefined) {
                process.exit(1)
            }
            console.log("hacking", current)
            res.push(fuzz_loop(current));
        }
        await Promise.all(res);
        res = []
    }
}


// const vvc = ['0x028e312f74c484ecb4bb3a11a64748911e0e130e', '0x72d57d6a945adf53cd7c1b83802858b08636e6aa', '0xDdF0Fb0f3486f318A76AE1D95dC93A09108259e1', '0x3b1f55fB8720766284a27c16CE056b06686491Db', '0xc9b036a4e88fbe2e0048c7212dd77e202f764633', '0x694fd1B34bB9d9EEe94b652ac099e278FDC100C3', '0xdbDff6522a364a220D5A2CA20c5d6103b5f48600', '0xd984a3eb387903acd7034a77ab4f83da76c6de57', '0x1a412366a488136eaa1114cd1a6d4d5062ecd2b1', '0x281789862ebb7b177ad28e5bef8738c63d9b5a83', '0xe29d640a22df180a9031f93381168234af24e939', '0xD2BF95f4Eddfa2180444D8B6afEd54F93eC1D7c9', '0x07e5c9599d86e7b3F80324fF193fb1A9e21566C0', '0xF446c22019fF40037024D88801863916ded09564', '0x74960752b81103dF6e9137665d1B0F6FA7421dA4', '0x007e06c3ae5227285a0fb40c70de7ac16a50595a', '0x35baa88ff835ccec34cd04f5ada265b9ff186d79', '0xbe94e86b350bd83202f1fe36f39f2c6fa09b2e80', '0xCadc1fE5187570B1D1209ca9D60FE4952963a9bA', '0x1A9EeDc7bD514F829cC2e074E9CB0D4FF5F9AD61', '0x6E85A35fFfE1326e230411f4f3c31c493B05263C', '0x6998388b980384bce5df94c78f3ac0eac1a5ee98', '0x6a1335cebd497a0b4f9821186571621a4b905c1c', '0x64c79CEa0046CBA1B073a56c7a335FD79303A7d7', '0x96Ff1506F7aC06B95486E09529c7eFb9DfEF601E', '0xf46b5b64b3652ec198d97beedd7bd9fa1d3d9d38', '0xc1ada6af339f2737e6e200ad16d2db0fa11cb4b6', '0x0BA668d307C717a396B10f91fCF4FA3f90BAD4a2', '0xa30243610844CA7f3Fe99292E2BE2954Df64B554', '0x5c1290ada773e115ba7e7318454fe9b50d30c099', '0xa65C11dD6184F8942994565952A2741C16e94d38', '0xCF2e832E3711947A71f9D92F6465156FdFDcD0b0', '0x0e86a6510b636bcfe0fb40114fd78fec9f6069b0', '0x40fc25f202468e71821d0619de19a968792f7603', '0x79232a7d43494064e37a02c2223927bf3c64f86c', '0xd4E596c0d5aD06724f4980ff9B73438FEb1504EE', '0xbA745170516e244e9c4FEEF2Ec388814E9BD8d38', '0x4e5169207994f4CA5083016C66476Bef61aDde37', '0x4322cbF6a2f91833AD24cc53424f592592004E87', '0x11f64fF090DbEb1B0630cAa90a8DFBb70F45db5F', '0x0415023846Ff1C6016c4d9621de12b24B2402979', '0xE62c4454d1dd6B727eB7952888B31a74969086B8', '0x9ff4D98b26CFFbBd417198D4AAb62cBc08744a10', '0x7773e4d91B9dce9c65bc2a702Fd291a19DC61270', '0xb189a664dc205a0f8c900bd994b7274478d028c7', '0xE3a7FB9C6790b02Dcfa03B6ED9cda38710413569', '0x188eac0dfe7053548e1b02ba92a6bf7d47956ee1', '0xa75d9ca2a0a1D547409D82e1B06618EC284A2CeD', '0x348BA8d3FC21cC81301AD00ec46D1d6b1c4a9591', '0x2BC434f7F06FBcf28aE2779c93C59c634461feB9', '0x6C7Ff517290f095017cfBd4d20962EB85Fc25c6b', '0xdcd7b72a865e5cb93e9b25c8f16f4068a6106307', '0x95ED16493B795D7af7F1028d0aDDD909CD6Da79D', '0x1Ad454504c8bDcaef7ed8d7945402bf64E388C86', '0x0b78bbd9cf57c341d63c01499e5762083c142d01', '0xe2360181b9fbfb6bbaab9379f35b835f59e94d7a', '0xdb03278B2745DFB813Ea2b196BD5d3fF07963a83', '0x823a3c9e66996b71bc914184c54410a06db149bd', '0x32cf502475ab03b292bdeff3123569612440463e', '0xBA716EBF18Dd01aEF3Fe03878cA977f23B941da4', '0x01ea9b284b45fc5ce1b9513Ef0cBF8b8835fa540', '0x790d8E477cb48Ea0ce06414Eb4Fb54A235cF4fFe', '0xfa113fbc108278cf19fb4a92a7797a9eb2039687', '0x3519c35423F4F12bc6AffEF7ebfd68e7e50846ad', '0x0176020e95a0d8b825668176aea327c15ae37bb6', '0x90eccbd79f5842940fba4dd272703d0f2370e863', '0x3f81fc257f4238bb93a48e94225621d1d912fe46', '0x898915fa46F091939fc169b649837a1FaBce618a', '0xb0dEFC14E98413D9E4bE0FE9DB7221608A27D6Eb', '0xDC664519283cE9Ea1F2239D0bc50aeffCFB26555', '0xC778Cd3Ba0B4606b6deBC556E0752A10D3eC7b23', '0x9277ed214d1efff18332d6bf2e0664517873ded8', '0x3ea84dae7daa700ee872681692ffdefff32185f2', '0x1aea739cdd259c4f758ea77e137e231e300292cc', '0xd4D91f2e38E87E5b6eCC101763b68068b1301f77', '0xe7c96fab317530b4475ee4d0e592e8ac0e3e662c', '0x89a236acd0b865bc2b19ae946d5c1e2631aa9fe8', '0x204d603e8dbd2f1e40feb35eaba029a38d5da1f4', '0x6b99833999ffd5520b8cbabcd54349dda16c3fcb', '0xFEa89038A290c5Aa17d046F9FcF4c99CB703c795', '0x166365d44520ac7a4e25249F72c3590AE42B2759', '0xbdbe8ff5755aa3c94e22b245ec51bdd1527134ab', '0x4d7961798a4f9e85a9799cfde98cecb39cccd322', '0x43F7270F626cb42d5d08de6AB53eF2A251b6C5D0', '0xfb4a4064ef6b958def4276f8b6ea3577db4328fa', '0x9e673A94b60aAC927f8AE9308272D46296652542', '0x11af449D75132b9ed1EF24AED0e161165059Afb4', '0x14941b8bc89b2213258429c56b5379d8da81ef12', '0xbda3b82cebf881492ea566c1a86a89375e7e4f96', '0x38e9f57387eb980f3bb637a1d8c4a46f04a4a3c7', '0x2E83BC574B46CF9aB327406000D3b7c2f5cF1104', '0x380ffec3a476a786f4036b828fce0717b307a455', '0x4c848799c9c766a2b0dce7a9f6d3fbafcf30134b', '0x7c43bcc3746a7bc5f17140337a7a8a4bc3adb892', '0xa6f1a50cd097824fc64f45c8fa0970e4fa5a953a', '0x642Fb46fB7cB76F5315c14d9f1872a94c4B6AcBe', '0x7cf3c5867b052251f56103fd3c35de1076484327', '0xd0244ed06b6a2df73b66c348b180081f8e775b1c', '0xcf63dd9bb90f2470b57ee552dec85ba5792e682f', '0x609a31ff49ba82dc5a17eec02d3c4e47e0d12c5c', '0x89eb2560095d51a35a75a46c2c535066dac0c3cf', '0x1A6FA385a1020c8A6f66f314b9c8E7798112f28D', '0x33251C60d690684cFE296A951691666d58FDCB08', '0x20fa889f428658678cb4647de293b85308969a9d', '0xFeDcA0d419307192834A3212BFef873F967E40b5', '0x0bc4e6eaa98a67bdf369e02638f691a2f5d1aae4', '0x1608d72B1F3B031BdB69ceaEF0aE943FE7526B3A', '0xd70e560f183b7862883d8d87e9615dd1d34a9b31', '0x5e0ff5cac23837826ac6788295406130c25aaf47', '0x3eF8dcC299041C9758f879Ea7f096D73fb62A023', '0xE09ab5498697c39Be7Af957195f97F80a8bbD25B', '0x6121d1baff544cef8d4e8ae7b3dc04e30fe5eb6d', '0xdb55890c51cc1d9a77ca9197eca429237e1af100', '0x8c546eb590ae28fe7f6f763ac40a63211c244188', '0xbB4C8232adDb396C7F1007401536E2F589cffEF8', '0x180411f676027cda473c63c0112aee57028dfea8', '0xA915EA87f8fcE8f35Da109D2FC426057aB8a9f06', '0x4EaAb97C8Ee33E5E87D40F6F55d16b4323e0e81f', '0xc66Ca06017C1f7aA747B5A70558B036229d5924b', '0x3549289f8bef925c1d2601237e26b65d0f719f70', '0x17dc7aeB258Aa5D9aC8D6E3d681D63952717D5aE', '0x772201ee27cf0a16adbc78403949c530a1ca6925', '0x34cf89612c1954e190aa64c9a8b7fde791f40e26', '0x5a984c13feb68bcacbba4c41874d9356fb81c5fa', '0xd53236f566a77d2e7955bd1c5b508a7b8505a681', '0x2d6db613d76312e418c94ef615a9c7edb0549f9c', '0xbdfcaf394166b0b50fec320b3dd986442e332728', '0x77745c838b4320cc0fcaaa3eebc087792e1e4051', '0x953a6c3c4B275a3ECC63D3FaaB42B174949d13B2', '0x7b1240bD0172498f2D3CdaF295E3271D0EB01848', '0x5065Da0F21e578e0De12caF38e2a93A28e815366', '0xf78fe292d5a8f510efa27bb0f16e1fa53af6668e', '0xC7D92599f8cc8D0efDd850A78641c25672D76982', '0x45c482fd6e11f1133bbaaf8d9b7e151d87fec7fa', '0x4E2ef5EF53b0338A16d0525aaBb035efDA69c40a', '0xed2ad4f7aed940e99fa004cce42c2cfa3c96d82a', '0x5a8cfE142D4Ff30dcF80Ea1573469d2a72FE840a', '0x3d59EE15e55783C310Bc4a0D96Eae3bE6F484688', '0xb9a9399edc76a7a1a467a4c5d86cc016ab09e283', '0x499287Ace79c0676F788aE95925792529c3A981E', '0xc0f08badb187e32d5b6ab47de892822b042c9d44', '0x06fA1F0a93d3Cf50a31865032bA5d9498caA6f2B', '0xa1c0d1007b001bd9ea14305584b5d87f7cbe5616', '0x0E66b5D0b3CE8A28ea2890393B06125eb100fE0b', '0x4BB429d93E09Bed40856ABCeA327d14363cDE34d', '0xc751bAA1FC5Fb1B8bac024B19d23309F66a80C6E', '0x715496BfaEb56905d4f4A1982ee8372F1844c08f', '0x167eae7a0fab0c85e1a5e0cdbaa1744682f0b8fa', '0x3d3F16d6e15dd86c4cd3397c174C6A72495DFAEb', '0x5A3301803CA4104354e0C804F9BE6d88D370c837', '0x197a3cee016778b6f8c2dc5f8e2e96a952790057', '0xed1eab9caf1099baf9f42a34a8336fb40843b22a', '0xD094d253941144AcCaDDbB560777cCf3Ffc0e372', '0x0374cb98688213342ac0ffbb8a756b4166b68612', '0x8b2eb9902C5f45d6262e7E1eeb50234DBb821A14', '0xB4003758F0b4CC604410766d81A688663d51B296', '0x029b1F09EF0Aa685ca537eADCb31b8217AaCBfa0', '0xDa362188929d176Fe821FCeC8393152CeaE4Df8F', '0x9bedea7e8ef15f1ba4354b94616e30cec760e42a', '0x2140e5d655a645c55fb9a18d32f274bd67aa43b4', '0xa12a31d10a7de05916e21543eef9527f7a0f5934', '0x8b179efc9502476b057b7e857cc273a334bc9879', '0xbb36068ec78bac45e763207662f383778b47cc2c', '0xad506a2a59bfbC47c1E78a1B56DcB26185BA4944', '0x9fAE30516Ebe02Bb4C472b91848C7D9887f28494', '0x790d1f0ec683b489f7cfa9e4bf69bee90836556c', '0x001895CD254F45B6eEe5EaE41Bf263c8b3124B3a', '0xff965effa6a9e5a9b21c28daf230ec794c154641', '0x6b2eef13d7aa4ffe643b532d42678146ab57b32d', '0x0c9c1d7bc0da13a827afedeb6124897b492f50d0', '0xa0e5e6dcdb4a17cc3b21f14c2c651ca241907316', '0x20E895469fDA3F6672a3A3dE609B42A8A894e4e5', '0x47ab530f52431cf41976778833b35a0d455d4827', '0xcac1aa6e72d1c14b3fa9e7eefc11228d7a14744c', '0xA8ECC18e54bD54bB1d91f827b99236BCda36613a', '0x78b3E8A50502EDfA4Cfe0C921C82Eb25d61ecF46', '0xecC0e4708fbdb07B546C0D33a214C324b6A85dc2', '0xb59576cdbd7d714cc4b4df335d3de0ad1c72a7d2', '0x2f725cb7b6827bb4b02db1369b1e4c6a33e5633d', '0x40133d54c557aE6C9901b55E3e99CbCEe397Dd06', '0x67c06af5352565a04f4c141330bf57149f2b6091', '0xfd79a8b4f2741f04cb0b8d5d182d121fdc8ad894', '0xd85f4576a601da078f1995a39e19e04c44a74e20', '0xbd02e321519f51a66836f575903e3cefb27d8090', '0xe39EA288C1e5C299d222bF47fd7346475f643265', '0x19c9e9ae26bec757ec01f453d412271a4fe9953b', '0x4c14a3164e604f6402e5b9e0aff2e734570313f0', '0xD8176eA59FC29FD8251e32Ea7EF121d4717f1580', '0x58Ee94C32097AB1961C2Ad412131B21fda8Ea198', '0x8ff258a3facc53dc0d352b480971f911357dbd98', '0xdcD2639c3Bcf69F0fc97626ED05efAA92d97b5d1', '0xfff640def57e4e849b0ff7df164b7924ed883d53', '0x790bef68655dc24022cd91cafb3af0e19535b70b', '0x6d3eD1567ed2a56Ab573429A8ac35Ca368A6A68A', '0x73b978ddb270e561bc67421fb0070c0dcda98922', '0xa4c0a3e846376592d70c618d5e6f9b9f2912c74e', '0x6c5ecba2af462fa224c0dbbd28a993c766aa8a7a', '0xddd67f4f846dc0fbf1b8a4f6172730fef6aff5a8', '0xC03146319F8647deCfB2b3E2958c407B5B2902E1', '0x0D0fcD0Ada595907C41BdAe8E4180eBa700A5B39', '0xb2517B9a3D793E8aD8AC787D75A7b014dABd26a6', '0xC8FE90fF9C9f4d08C0d5D45538AC1114B7eB55e9', '0xC0ad266356ae567FE77c99F3786Bcb4AD20A2FF3', '0x689faD88202B4E40b0e9bDCBDC11129e7e53fB0F', '0xD50E4A7D75F4cBE771D7Cf8a9d95112a7dD3882f', '0x0BDF4988E47987c9AaF49692f7e6C0194CAcf71c', '0xf7a4b79746a4116b3e1dce9f1f756d66e508bdf0', '0x2fb95f8197ce68380c33312ac541a0225f36a9bd', '0x07afdd0f81d090f7da12dc96a087915be89e7c97', '0x41908c22b114d6a3e1317600e944a61aaf124eb2', '0xf04a3021dce2b7e33536202b68a018d730a99045', '0x0B65dbed4bfBB3E2e3B2975acaa7AaD8286D84B8', '0x91981695b22d2e601366d6f9ec9862458a5755ef', '0xc3118fa49448a54bba7c867e15b9f5b2b0d37315', '0x0f68f7bb07b6638042762cf8fdad812b80bfea90', '0xf8f840ab06ca4db83a22ddeaf03141097b6105c5', '0xb0323720f49dcfea664e695edd5a515905f2eae1', '0xfb3bEAA48D5f9CF26628c126704F1B61308D0CbA', '0xF8b44501e32BbA766fc54AE118754A54BC7b2784', '0xddad5260499908f06c81e129353737a3ecce0919', '0x2793AE5Ff91B9AeC517a7E9A5131A94C95f562DF', '0x93f3501ade7f8c0509a879ac8bfa36b36fee6676', '0x1102f47254e3c0336864af1d43460ca0df039009', '0x2787438D38c2c9675c62b6799aCBb0BA345834B2', '0x152dB95507E301A90bB92997138Fd0f6144E1635', '0xc4595bdebe43ea22981bdd68014a6e39c2607f30', '0xC5057C26DF70710fC2f321663e6D1D3ecD6bCC02', '0x38cffd5f9f32608acf77511ccff7d17589a1b60e', '0x5fE087Fd5c741EE49e16De93626De76bEd3F5Ba9', '0xc46641255dcb0e576c76ac9b33f138dd3657be0d', '0xda2645335eefe5436893000efc2f94babf9ef5d2', '0x286a9cd4b3041cda9f81aec3a5e6ed02b7453ca5', '0x73615edfb312d7a7c1f0e8e0779e0cff079ddd62', '0x1ccedb2b35cb7432b741aaaf564a1f0472f153d9', '0x150093Dc0eFF186281B2786C68DF5E3B3D01ceB0', '0x0d831ac1d6d415f28aa5c5a3a5900b13aad9644b', '0xA7aa691Bfb581d3CAe59e739276Cf22390072F8A', '0xed6367f508da778ff2f60e6fc34fbc03d85323d4', '0x0b578b1414Bc5601624f95Fb06f55FdEd8cB1D8B', '0x5BDA1676f37dD57960Ef381F092380184F923B9c', '0xe94267480e18d5896d7b20aa7a96a5a34400f734', '0x4643d808457deb99bfd6b26ab7e20261517fe6f5', '0x93e6dc506aba6854bb2ccc2b376fc0669d9ae4ed', '0x1776Dab07e87dc4F87231541FeBac5ED3d4C1678', '0xa1C5dfb03Ff6B19671B2545a6fd41448672464Dd', '0x7e9ac0eec10e63a266cb5357cdd904d82120127f', '0xE6a932EfB0bEA2BDAfe2F676f2dAA5b4182f282e', '0x6347E1D9EdCbF20a59c9Df1C6010f0AB4eb45d2A', '0xdFf56Dbde99c1CD694AdE0f8E1A0fb5Ec546E324', '0x99746eaf1545E04324aA24E9e70854B7a34ffB08', '0x75446d95c29143f7B31B76991bc6b9754Cf6637D', '0x7aeaa2264F72e668e5E01f320Ad4e8E6Ae4A384b', '0x4270E0C3530e587eD1B588Db6f91fa7d70b03808', '0xe95b7836c1059F6dEA8aadaD486ab37E244e0Ddd', '0x833333b264E153bF7416BE008CCcAF26304bBE61', '0x781d03ae9ac900e81ed5d83607fc5affc52d02a8', '0x1ab083de35773900c4bed25816562dead7738975', '0x42d3042745edf3d0aed34abbbe96a534e8094869', '0xb1869596d70100e2b1c83569070b40c0811b4106', '0x84fFB3BdE83ef1c3b59Fc17137d4a6080768632c', '0x47ab9435f518855eb5e0d7ac6dfc68e954be0f63', '0x242A1E8F6da44027193E895c23e8aFC44013674d', '0x304fbe5d8ac571d21dc1ee18835db63270b51540', '0x9AF37f590d06c56070994004571342f67D43C478', '0xaa57d9238a9bb304152c4df984f9ae6b87c4ff63', '0x429aa04b4db68af4e6a95be5dca482efd538facb', '0x05b8aebf02655138ced8c428c5f220b75ba67a75', '0x890F0123697e97B4927BCEf38a3B2E0B65a43a0f', '0xa204852ccff68986263595160cd770092815873f', '0xb804106236556b79a599fce684130cd6ac06a833', '0xe16AD75Ee64542DA41Dfe6c2e1b854118560671a', '0xa067bc237ad6487ad32F2a86c275Ba5648748FAE', '0xbaA8904637D2dBd23924A794089A2D7AC250BF22', '0x655e25c5d787f8ba713a9e32702fbcd48f5b4944', '0x2234ad0821c7587f713b0cbbc998586b52c551e3', '0x79dc0f8f1f651a3b9def993697ed96618c1b727f', '0x70563C10c8B9Af793C685184c57EB4Ce9B5C9211', '0xE5c9A062A6f643F6a7A3B97605fA5838Bf79Ea99', '0x0CD303bEd162FB9bCE9099f839BB9C36715D919A', '0xed7446652fd46c4789c29077d2bdb3f52c44ede6', '0x5b96C472619778Ed2990f5939462fC981890F7A3', '0x9d737dc616d4c604d1b96af2185bced5aadaf137', '0x16696794854519e8577b6296ae9a7f7946146402', '0xa9Ccc903D5983848f22BDa9438eA5f2bBd060711', '0x6d72210cee255ccfdd499fb7f3e6ab389eb4da55', '0x76A2fC98F919463f68c5E838c6F2d0655f341392', '0x8f823866783d99ddb85e180ce656dbf6511378b6', '0xc6d29c9c71d52a33cb567fdfec5b47d70f8e18c1', '0xf4D91515b23ae623Ce1E6a34a40b294cA6a239af', '0x27ff626e42cf8e1f265ec821a4a2318c0a982078', '0xF081eA75ED4a6445219473Ff13da1F357e7df3b7', '0xf1da0cc69686fea60dac1fbc83cd0df3d42e0b22', '0xb3555095f4d5a3755c39b0bac9ceeaa972e131e3', '0xe9a347b4efd366fe63ff1a6f60a160ddd0ac047c', '0x795bf54af6178d759743bed8c3829eb6430dcfee', '0x81d69C42A510acead9F5aB1AE9e3fE105159D190', '0x1725C44e1075D2849daDd600882851ECaFa81E66', '0x8ed8568dcde39ae8c044a59adfc6cfa582504add', '0x55ECF24C163B36f808bDF005e4b41d7Ef3473F38', '0x83eD8707B6C4ff9FC0917806be0De70b6A12AEcc', '0xAD4178D1aF8979C0c5D77c47a13eB2915C7D0324', '0x91980F619E24de3aa5ABfccBD5a7c558e3b0D0aC', '0x45717c2006166f42d25851daea330222427de534', '0x71f354915b2D71dEB638A20e8430b1Eb90344dd7', '0x1b1b98b81df5f8a3924300b64de94dc1f0ad79a1', '0x53A6BDBCCd96BadBc5F98a2e6c8319Dd34D85E3b', '0xBAa336ecf7E215c48fB7692fE66b6d363628f250', '0x899c78a897DE26D54056C818B672bBbE3cf7c601', '0x1699BFF78070B1C5050310c3Fb87FA82B5305869', '0x9998f96e243bd59dcb29e73445e3dbf5c2bf2378', '0xb358d725e5d85dc2c7c8738b7a16b8e35ca5e20d', '0x33b970dbf2e03e01bca30b9b72d3c2f29fb2cf1a', '0x5b4640bF67aE2baC7C0b19e8B465CDd10B2a94DC', '0x1d9b347c8d48ad8bf39dec1df37c6694de43d34f', '0x112Ff7064F0F5Fd607D2f743916Eb5737c718284', '0xcf124cb8a4c5e9ac4dd1ab13dace8a26cc07053b', '0x26ab279B749FbD4D88C23f9034F6F2c7a2d0EA45', '0x390e559f9dda689b368080b35a639b6690e09266', '0xb323d01053f0137dCa0cc0030b9b4820C8B81A3a', '0x514a713e14ae44f2026852cd02c6adbdb4024954', '0x1a881d70d8744e9b46a67c667205402b19a2aafb', '0xff109dbd6bb4f12abc9dfd7f243a2119e51d459c', '0x0858e87550222beb520d40a5eae06c942f326950', '0xa4da08a3f8f60b6f3dc9b92a4b132259465d94d7', '0xeBE0A1D0F088CCa9732c7990f07BdABf7F3Cc5fa', '0x31720c97446322f87f21cd17d6c44517b7848421', '0xca7d53233e599d5c632f341acaec53776b54b4d2', '0x331a47e2087ef211e57381a57d6f6bdc2185e12d', '0x41e42aAe8f4d6702d1db4683C2f6808521C43F45', '0xaF66c99ca90012C99cB8247569cF2add76340a15', '0x4007A132dE7B81070f42D47417B32E13301020a1', '0x3b160adaaddb2a45718647744368bbb65e3e8bed', '0xB6F5e7a3ea08CC073FcD8E42A0eD790e533056aF', '0xfc27656f27143a88da7acd6ae3be91c63156ad70', '0xa0B85507838002C952D629ce1a12f93971436409', '0xc76458381F9A97316290879758566327883F63b9', '0x861319bf2cc2e2d61d906d73ddcbc0831132f8f8', '0x6CC2B44778C02a957d4EdBC3C0389bb918582aaC', '0xa573fdA6398f3A604731E588e4Be474725f89adB', '0x1d4777daa4f7ab1fc6f6c2b870b50a113e8fcc4e', '0x692E922453dfffaAED14E5Bcb62289af25180b21', '0xc39db8ee8cab77eadc3e8cbebbc6e3a3089330de', '0x79cf8bd40412eebdca02289629a7232c7ba91726', '0xfc5ce77dac8936c3021746ab203543cf1b0fe48e', '0x01d6cbff636187a6547b96896aa420f69ca3945e', '0x0c15611f60E515F9dbA492fc8D57993BcdfF1ab6', '0x1e98F31d6F0Cb43598b398596b596Fddb8CaD5E9', '0xfBd44b158d02996048402BAF4Db357D13113eDC5', '0x29b4eed40d1684b2ae949fc861bb0f33dede5aa8', '0x9441ee7143b0581b2D56F84a68eE60e5018689BC', '0x74A21a1f1B5a14df94e0A98E98AF537410Bd4301', '0xae541479012e85bf86da01c54df4ee23ecb391f7', '0x9e7215Fde9696659a2540fa641a9aBBeAf3CB263', '0xaf8ac169fa135d0e772005fd2f6f4046c65e4852', '0xb4f29e11695f1a55e08e4c40e3941280408c50d9', '0xcfc97aa25d8540f6ee3967460a70c9e635d3a6f0', '0xcE332Bb559BA8d108c2211aEa5f6A96a9f6b557C', '0x23E5fA77F0C8ca1bFE6ca18a8aeA6773cd9D3961', '0x078a4706d39faf6b18c4f4c7848f9e416b88ca3a', '0xc9b7e1bb224242186ced8b96ab0f18b598f234ce', '0x15c769e7339892f72074a0596ea9de14ce2f9824', '0xa5af488772d9b5497c42b81d271e3e5ac4c21779', '0x8261f09b88f98466879ac5615a7209d70cbbfdf4', '0xB71b8FEDDC4B1AA87e04Bd565dAda0A4b62854F1', '0x76a7f1d4f73F382e9D7683fA253bE2F673e891BB', '0x279BaB4836e83a4c1e9FBD0f672B0C81D2aC4Dfc', '0xBf0d9b41cF2b61D677fe09129DB922Db88188149', '0x6f3a73137b3bd158319d81cc493fcd89e18e9050', '0xD8177650a5799d3Ee129Ca1567b52aD79F649968', '0xB30922FaAD5912fA5CED5574c2891a47C0CB6297', '0x5364af7fd12C683a995531533Ce23C28EaC1517b', '0x630844b027820e28f35d34bb3305a198232b6c9d', '0x89046Fc7285F06065b5c8cc00999E6d67f0889ac', '0x6f19dfd747091a70121998f4a582e94ad44b0dde', '0xba8914d8fd5f182cf7067e290ee44d063b51d89b', '0x137AC4d4bc6E64Fb8BDFA7eC18377F1adB5D8afe', '0xDd40d26F7bb43e8b29a31FC1f897097C287c6307', '0x2e6e2497f590543f2aba45d65e41702bdb1aa563', '0x0604AC0317d436d580408a7BE9984452d617e19F', '0x3624Ff15a187F986ceeCbeB332E15ed35D64F622', '0xdaef42e156c0713f5be0fc9319afbdf20c71ba84', '0x9e0F1161A18a4C4576500E0fA29eAF9b24799acb', '0xCdD3cD4F575394799bfAE45Ace612Ef997729C1A', '0xa662b09a966de049d558127e04fadc061c193ac8', '0xe5FfFE2Fd71367B0d15Fd10AA00B7d312B101e13', '0x9a31259185e3042F05b74B3848Be0aDd425881dD', '0xf3bd5fc3424056bb0886594f18820185ed57be0c', '0xc77c4beec2b301abd10cef9eb1dc84f45beca3b3', '0x1f4fd2c980cb45203d3b4ba3fb511ff7ca732d53', '0x258A0Fa7B9508fc2501C6536c0D0C5383A01E3bB', '0x45F2f51373E84dCC20F3361Fc4B4570295Cafa19', '0x2db7bed3063a0cbd8adb15d69c310d50fc1d3b7a', '0xa501D4Ed42e6f67A4c0C71B2a9d98238fe14eBDe', '0xF1ef84c646321625c25F8728565591887e87DF31', '0xED5E4fa4348a67A2C84636D3cd87eE7858338961', '0xEe449189A8686C0f3235Bd391ebaB22E9fa91773', '0x022a98c7f49654e2f4bcdb46a8460c76db954215', '0xe4dca3d5baf42eb9a5251f184f595962da050a9a', '0x40d51B3fA36eFD3988C0E8514b60fB6862A2A33B', '0x0179ed5147592068a37c67608d7dff823c935816', '0x8225d5c637fcd17f32af74f060ba23f4775d4886', '0x3b02168767c85ddec495ac99d719d5afa1d87db2', '0x3694476c6156Cb49cF1a90C0E969f72B83527c46', '0x7d84eF0a945277D056Df28a9EBd5E95F333E2505', '0x0d5d239c3e809840fa71352b30795031d24a4483', '0xcBE1502Be91b8d873302010D6c588ae676b2d8A1', '0x20d16dc56d7546218b231381fca08b28ad793ea6', '0x8179c125f71c188Ee6f7169ce47FC441dFaB41fD', '0xe2d072e208d45795315730dde617573325ca93b7', '0xa2999490e037e1de4c28da04fc8471aff77394c4', '0xBDA5d68C08245515B25FddCF34006F4771E20CF5', '0x05b61Cc6eeE6d0a4AC4E91b3E3A3ad9a16A6b5BD', '0x7FFdd7136ce32b13733cCd3F784ee581e1Ad660b', '0x887d50A8199356f3dF0af4d9dF10aDA06B0a1753', '0x2d8a42354b92719f6100f3fb0eca08d8a3ecf4d7', '0x1793F875FD7095a2A51136fE554e3ccA20515FEB', '0x082e237efd544ceba3e3dc9f17820d758632eeda', '0xea2cC536502b2bBd0DC0e7E91DB4bbbA01DB6882', '0x77e83fe2f41ff30f4f4d83bf81690afe36adf8c0', '0xA9D9B724637C7F6eCB3c8d30f2a14fBABF8111DB', '0x06d0294c1ceaa91e67c0d269564fb2ed9673a31c', '0xDA4aeAC0Db99B23C3cfb3E363289e11a04F8030A', '0x849c51730194435a8285fe7600f2fb17db6970a0', '0x0655915cDa420360f09921A0FBb63F6b5B65461E', '0x316453c75f2BfF94A9B68E43CaE8F19Da3E79c48', '0x9bcf9a6b33dcf4589abc519b65f0dc0d35fc1705', '0xbf306a453f0b2e890f65a8c83808458c0f4fe611', '0x033c0564a590d10c8c748025da6e1e20d5bfbed2', '0xffb87211f1e45fa0403b70a3af248179c10be860', '0xc6A2EB500f0EB06Ee75E2C1e4D0734104cB2b831', '0xae412495eed9ebe7d5a9041848df11ebdd6137d1', '0x5837525c870c7Ec79A5049D32608B120397C3A24', '0xd3a76307645b353b47caa7e0a9a67bfc13b8b879', '0x1fd90269af71d676dd21b89033cccab36c3eb0f4', '0x158B3c2b620170987E7f9F63b97a814974FeddB1', '0x9aa72ced2383f654bc98a288ccde6f7817caa3db', '0x38B56731960A5ae28DAC124e69481de9a332b692', '0xa30800ee98513ec389a5b37581f8a59ece248253', '0x4196257C46CE1f6Fb47ec002343ed8273Dc38720', '0x8a964b2628a75935e602b5d1e843b23500d3da63', '0x992fE7Bd99b6Dc2D6cd279f8e019471a922fe120', '0x3FF336BDB692ce93a2fd042c6E12873eA3F76486', '0x67b8c65B746eA450A5bE94ba235EaAD1FfF4C6ac', '0xac2b0f0e21c14eb910fc389698248a6b03362cf6', '0xcBa8B4a7fA740702795209f0197A56BaAB843229', '0x98dC5270c12cF8a85AfBa1F980e4a6b93Fb80EC5', '0xd062233FD67Ae91773e79b1a38bB31b0e55F57c8', '0x1b36e630e6140d76f989bee0130e8d60442a66b9', '0x10f7424aa0f34376cca1db33e5175573eafdad8c', '0xE6A9adDdB90c0e9beF5668788d5b3FeBA28e3AF4', '0xfa946Fd53fF8Eae86ab2aDBcf7e7e5fa566330de', '0x9eC419Bd5B5AE06E8D051f91610E69fc7c52589c', '0xd5555c8b2b6e5825cee4caa05acd942311fe3294', '0x4BC03889FAF2CfBF84CA320C9279289646736211', '0x46bff9144ec7ab213dc031cd90c1319d8ab3a746', '0xd8fb316460781f38950d72f6440b157c4797c588', '0x0256D022D74d9bcEe59B08a5654c20a45b35d27b', '0xdc1f650d6f36328852d9336d531fd5ca384abf09', '0x736977A5DEc36B502c4c5B3a5486eb8bd11Ee237', '0x0b42a0f1c76668c93d20ea5587cb4db118b8d19b', '0x2f8ac101b01ab6c6bbc25d92261084c0edf436f4', '0x64f4a155bfebcdaecbe7b7c73b272f4e445b3cea', '0x3aac9d3cee543f116f9a57d130c4ccc3d5c799ca', '0x8Ca9EA6AC6a8C96a7aaE73525972fFa67cd2daa3', '0x2fdf18b979fdc780D11ec1D9DC571D51fd1b7ce7', '0xb6439D3Ba5eB1328ddC3dd92Beb782b6ebf1BFB2', '0x530d72AEdD83Ec93D1aA570e8f0bbb76085122bC', '0x9B4196bA6f8f70048883357b76445B3bcdf9C71C', '0x0aCC255724b632B6872e61F21c5405278246254b', '0xbb79cca4d1714b1a6413dfdce57e862d0ce701ef', '0x64bDdB5CCc42ca65D83337A0FF137E3CB0123BFe', '0x158172EdF8C7CbdA0033888A1ef9f518E385E488', '0x346BDd66dEA540e9F0Ef96DB7423477d9833aDEA', '0x94ffc85cb5b4d6819a99387dab8b4ad80cc0120c', '0xC8C0c4808CD6dF6B30Eb14Be37836557dE9344C7', '0x95AF159Ad5121dE29B23E3fdf5a15a7b76D79B7f', '0x4874b1E0085d3E28BB150a3392f3389132a9E7D2', '0xf29b5f34dfc8da0fbb92ad346780d3cbaa098d71', '0x1eb794af85355e1f63e38e9b6240e2a225d93900', '0x45b6Ce3156CCB909a1CE7CA82a8542C5D3014498', '0x564e62b70127dc106eea4b09e8070939782a3864', '0xa8dfF7B45B97425B503348cF605a49244669e439', '0x2135910c87c5734a5c888a28d42497f641f67d56', '0x7c366d5b0496035b8be9428463ea0accf3ee965d', '0x03B7914A31Bb05905d9418b2ebeE2936e380D867', '0x4C95C7AE3a6870965128fC272b0F484d1423DFE6', '0xba07032431f8297dff4ee9ac9205396c1b4e87bb', '0xb5a362714cbd8b3958ab4bc561110032e8db2d88', '0x4705dac0dcd7159e5384d22830e4c32aa49e8887', '0x0a5fc00dcf38c57da0491f0b111975235483074f', '0x511B5d3E96D215eA74548b8D16fB7bFb43F2F5bC', '0x655ecef47ec89d9018f4bb9e71c8c629ceec2df6', '0x8c6c5112a02667feaa1958db4c7ae6f80dae77b8', '0x9003157Ac157C6260Cfb8234Bf636055916ff874', '0x71ae00d0db2b4aa73c796345e9e433e62cf8a109', '0x0F3e349AfDa65a1ab50fAcfdBA727981e87B30a0', '0xc8afd6ced7366be336aeb832d41dc234518d624b', '0xFF965aED6CB1F32E77C73Bf48436F31D478aB9aD', '0x6aB539DdD54F52F5F1d14052B12C9AEDE764F74D', '0x64fFa2103AF1450D7E7B71635e4d050D8EbD8E1B']


// console.log(fuzz_loop("0x425f6F6e4D1D5E43EEBB551D3806715C2C082954"))
// hack(vvc)
// export {
//     fuzz_loop,
//     dag_t,
// }


fuzz_loop(process.argv[2]).then(r => process.exit(0));
