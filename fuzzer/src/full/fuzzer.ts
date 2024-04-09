import * as solanaWeb3 from '@solana/web3.js';
import * as fs from "fs";
import * as prompt from "prompt-sync";
import * as os from "os";

import * as fs from "fs";
import Web3 from "web3"
// @ts-ignore
import * as prompt from "prompt-sync";


let web3 = new Web3();

type FuzzContext = {
    methods: {
        name: string,
        abis: ABIMutators[],
        type: string
    }[]
}

type ContractInfo = {
    Code: Buffer,
    DeployedAddressId: Number
    DeployedAddress: Address,
    Ctx?: FuzzContext
    Oracle?: Oracle
    Web3Instance?: any
}

type Oracle = {
    methods: {
        name: string
    }[]
}

const to_address = (address: number) : Address => {
    const buf = Buffer.alloc(20, 0);
    Buffer.from(address.toString(16)).copy(buf);

    return new Address(buf)
}

let contract_deployed_count: number = 0;

const deploy_contract = async (address: Address, data: Buffer, eei: EEI) : Promise<ContractInfo> => {
    const evm = await get_EVM(eei);
    contract_deployed_count += 1
    const deployed_address = to_address(contract_deployed_count);
    return await evm
        .runCode({
            code: data,
            gasLimit: BigInt(100000000000000000000),
            caller: address,
            origin: address,
            address: deployed_address
        })
        .then(async (results) => {
            return {
                Code: results.returnValue,
                DeployedAddressId: contract_deployed_count,
                DeployedAddress: deployed_address,
            }
        })
        .catch(e => {
            console.log(e)
            process.exit(-1)
        })
}

const peek_back = (arr: any[], idx: number = 0) => {
    return arr[arr.length - idx - 1];
}

type dag_t = {src: number, dst: number}[];

const run_transaction = async (address: Address, data: Buffer, eei: EEI, contract: ContractInfo) : Promise<{dag: dag_t, reverted: boolean}> => {
    await eei.checkpoint()
    const evm = await get_EVM(eei);
    reset_shared_dag();
    const p : Promise<boolean> = new Promise(async (resolve, reject) => {
        await evm
            .runCode({
                code: contract.Code,
                data: data,
                gasLimit: BigInt(100000000000000000000),
                caller: address,
                address: contract.DeployedAddress,
            })
            .then((results) => {
                // console.log(`Returned: ${results.returnValue.toString('hex')}`)
                // console.log(`gasUsed: ${results.executionGasUsed.toString()}`)
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

const run_oracles = async (address: Address, eei: EEI, contract: ContractInfo, w3: any) : Promise<{ violated: boolean, oracle_name: string, dag: dag_t }> => {

    let p : Promise<{ violated: boolean, oracle_name: string, dag: dag_t }> = new Promise(async (resolve, reject) => {
        if (!contract.Oracle) {
            console.log("internal error")
            process.exit(-1)
        }
        const evm = await get_EVM(eei);
        for (let i = 0; i < contract.Oracle.methods.length; i++) {
            const oracle_method = contract.Oracle.methods[i]
            const data = Buffer.from(w3.methods[oracle_method.name]().encodeABI().slice(2), "hex");
            await evm
                .runCode({
                    code: contract.Code,
                    data: data,
                    gasLimit: BigInt(100000000000000000000),
                    caller: address,
                    address: contract.DeployedAddress,
                })
                .then((results) => {
                    if (web3.eth.abi.decodeParameter('bool', "0x" + results.returnValue.toString("hex"))) {
                        return resolve({
                            violated: true,
                            dag: get_shared_dag(),
                            oracle_name: oracle_method.name,
                        })
                    }
                })
                .catch(console.error);
            // const oracle_method = contract.Oracle.methods[i]
            // const data = Buffer.from(w3.methods["lightfuzz_getval"]().encodeABI().slice(2), "hex");
            // await evm
            //   .runCode({
            //     code: contract.Code,
            //     data: data,
            //     gasLimit: BigInt(100000000000000000000),
            //     caller: address,
            //     address: contract.DeployedAddress,
            //   })
            //   .then((results) => {
            //     console.log(web3.eth.abi.decodeParameter('uint256', "0x" + results.returnValue.toString("hex")))
            //   })
            //   .catch(console.error);
            // process.exit(-1)
        }

        resolve({violated: false, dag: get_shared_dag(), oracle_name: ""});
    });
    return await p;
}

const rerun = async (input: string, contracts: { prefix: string }[]): Promise<{
    oracle: string,
    dag: dag_t,
    abis: ABIMutators[],
    eei: EEI,
    } | null> => {
    console.log("rerun", input)
    const stateManager = new FuzzStateManager();
    const {contract_info_arr} = await get_contract_info(contracts, stateManager);
    let parsed_input : {txn: any, oracle_name: string | undefined} = JSON.parse(input);
    console.log(parsed_input)
    const data = JSON.parse(parsed_input.txn);
    const contract = contract_info_arr[data.idx]

    const method: string = data.method;

    // @ts-ignore
    let method_info_arr = contract.Ctx.methods.filter(
        v => v.name === method
    )
    if (method_info_arr.length !== 1) {
        console.log("contract has multiple method with same name")
        return null
    }

    const method_info = method_info_arr[0]
    const abis = clone_abis(method_info.abis);
    for (let i = 0; i < abis.length; i++) {
        abis[i].deserialize(data.args[i]);
    }

    stateManager.fromJSON(data.sm);
    const caller = address_der(data.caller)
    const blockchain = await Blockchain.create()
    const eei = new EEI(stateManager, common, blockchain);
    await stateManager.checkpoint();
    const evm = await get_EVM(eei);
    reset_shared_dag()
    console.log("rerun", data.idx, method, abis)
    await evm
        .runCode({
            code: contract.Code,
            data: convert_instance_to_bytes(contract.Web3Instance, method, abis),
            gasLimit: BigInt(100000000000000000000),
            caller: caller,
            address: contract.DeployedAddress,
        })
        .then((results) => {
            // console.log(`Returned: ${results.returnValue.toString('hex')}`)
            // console.log(`gasUsed: ${results.executionGasUsed.toString()}`)
            if (results.exceptionError !== undefined) {
                stateManager.revert();
            }
            console.log(results.exceptionError)
        })
        .catch(console.error);
    let oracle_result = await run_oracles(caller, eei, contract, contract.Web3Instance);
    return {
        oracle: oracle_result.violated ? oracle_result.oracle_name : "",
        dag: oracle_result.dag,
        abis, eei
    };
}

const extract_callable_funcs = (abi: { name: string }[]) : string[] => {
    return abi.map(v => v.name)
}

function randomInteger(min : number, max: number) : number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/// ABI Generator ///

// todo use bigint here
type Web3V = number | string | Web3V[];

interface ABIMutators {
    mutate(): void
    copy(): ABIMutators
    serialize(): string
    deserialize(v: string): void
    v : Web3V
}

class Uint implements ABIMutators {
    _max: number;
    v: number;

    constructor(bits: number) {
        this._max = 10000 // Math.pow(2, bits)
        this.v = 0;
    }

    mutate() {
        this.v = randomInteger(0, this._max)
    }

    copy(): ABIMutators {
        let cv = new Uint(0);
        cv._max = this._max;
        cv.v = this.v
        return cv;
    }

    serialize(): string {
        return JSON.stringify({_max: this._max, v: this.v})
    }

    deserialize(v: string) {
        let res = JSON.parse(v);
        this._max = res._max;
        this.v = res.v;
    }
}

class Int implements ABIMutators {
    _max: number;
    _min: number;
    v: number;
    constructor(bits: number) {
        this._max = Math.pow(2, bits - 1) - 1
        this._min = - Math.pow(2, bits - 1)
        this.v = 0;
    }


    //todo better mutator
    mutate() {
        this.v = randomInteger(this._min, this._max)
    }

    copy(): ABIMutators {
        let cv = new Int(0);
        cv._max = this._max;
        cv._min = this._min;
        cv.v = this.v
        return cv;
    }

    serialize(): string {
        return JSON.stringify({_min: this._min, _max: this._max, v: this.v})
    }

    deserialize(v: string) {
        let res = JSON.parse(v);
        this._max = res._max;
        this._min = res._min;
        this.v = res.v;
    }
}

class String {

}

class Bytes {

}

class BytesM {
    constructor(bits: number) {
    }
}

class Tuple implements ABIMutators{
    v: Web3V[];
    objs: ABIMutators[];

    constructor() {
        this.v = [];
        this.objs = [];
    }

    push(item: ABIMutators) {
        this.objs.push(item);
        this.update_v()
    }

    private update_v() {
        this.v = [];
        this.objs.forEach(obj => {
            this.v.push(obj.v)
        })
    }

    mutate() {
        for (let i = 0; i < this.objs.length; i++) {
            if (randomInteger(0, this.objs.length / 2) == 0) {
                this.objs[i].mutate();
                this.v[i] = this.objs[i].v;
            }
        }
    }

    copy(): ABIMutators {
        let cv = new Tuple();
        this.objs.forEach(v => {
            cv.objs.push(v.copy())
        });
        this.v.forEach(v => {
            cv.v.push(v)
        })
        return cv;
    }

    serialize(): string {
        return JSON.stringify({v: this.v, objs: this.objs.map(v => v.serialize())})
    }

    deserialize(v: string) {
        let res = JSON.parse(v);
        this.v = res.v;
        for (let i = 0; i < this.objs.length; i++) {
            this.objs[i].deserialize(res.objs[i])
        }
    }
}

class Array {}


const get_bits = (name: string) : number => {
    name = name.replace(/[^0-9]/g, '');
    return parseInt(name);
}

const get_abi_instance = (name: string) => {
    if (name[0] == "(" && name[name.length] == ")") {
        // tuple
        let runes: string = ""
        let stack: number = 0;
        let tuple = new Tuple();
        for (let i = 1; i < name.length - 1; i++) {
            const rune = name[i];
            if (rune == "(") {
                stack += 1
            }
            if (rune == ")") {
                stack -= 1
            }
            if (rune == "," && stack == 0) {
                tuple.push(get_abi_instance(runes))
                runes = "";
                continue
            }
            runes += rune;
        }
        return tuple;
    }

    if (name.startsWith("uint")) {
        return new Uint(get_bits(name))
    }

    if (name.startsWith("int")) {
        return new Int(get_bits(name))
    }

    console.error("unknown type: " + name)
    process.exit(-1)
}

type ABIInput = {name: string, stateMutability: string, type: string, inputs: {internalType: string}[]};
const parse_abi = (json: ABIInput[]) : { ctx: FuzzContext, oracle: Oracle } => {
    return {
        ctx: {
            methods: json.filter(v =>
                v.type === "function" && !(v.name.startsWith("echidna") || v.name.startsWith("lightfuzz"))
            ).map(method_dict => {
                let abis = method_dict.inputs.map(i => {
                    return get_abi_instance(i.internalType)
                })
                return {
                    name: method_dict.name,
                    abis,
                    type: method_dict.stateMutability
                }
            })
        },
        oracle: {
            methods: json.filter(v =>
                v.type === "function" && (v.name.startsWith("echidna") || v.name.startsWith("lightfuzz"))
            ).map(method_dict => {
                return {
                    name: method_dict.name,
                }
            })
        }
    }
}

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London })

const convert_instance_to_bytes = (contract: any, method: string, instances: ABIMutators[]) : Buffer => {
    return Buffer.from(contract.methods[method](
        ...instances.map(instance => instance.v)
    ).encodeABI().slice(2), "hex");
}

const clone_abis = (abis: ABIMutators[]) : ABIMutators[] => abis.map(v => v.copy())

const mutate_abis = (abis: ABIMutators[]) => {
    const selector = randomInteger(0, abis.length - 1);
    abis[selector].mutate();
}

type corpus_t = {
    contract: ContractInfo
    method: string
    args: ABIMutators[],
    eei: EEI,
    idx: number
}[]

type eei_queue_t = {
    eei: EEI
    priority: number
}[]

const priority_sample = (eei_queue: eei_queue_t) : { i: number, eei: EEI } => {
    const total_priority = eei_queue.map(v => v.priority).reduce((a,b) => a + b);
    const threshold = Math.random() * total_priority;
    let k = 0;
    for (let i = 0; i < eei_queue.length; i++) {
        k += eei_queue[i].priority;
        if (k >= threshold)
            return {i, eei: eei_queue[i].eei};
    }
    return {i: eei_queue.length - 1, eei: eei_queue[eei_queue.length - 1].eei}
}

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

        this.code = new Buffer([])
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

    toJSON(): any {
        let serializedStorage: {[key: string]: string} = {} = {}
        this.storage.forEach((v, k) => {
            serializedStorage[k] = v.toJSON();
        })
        return {
            knownAddress: this.knownAddress.map(v => v.toBuffer().toString("hex")),
            storage: serializedStorage
        }
    }

    fromJSON(input: any) {
        this.knownAddress = []
        input.knownAddress?.forEach((v: string) => {
            this.knownAddress.push(new Address(Buffer.from(v, "hex")))
        })
        this.storage = new Map();
        Object.keys(input.storage).map((k: any) => {
            const sm = new SMData(undefined)
            sm.fromJSON(input.storage[k]);
            this.storage.set(k, sm)
        })
    }


    accountExists(address: Address): Promise<boolean> {
        console.log("accountExists")
        return Promise.resolve(this.knownAddress.map((a: Address) => a.equals(address)).reduce((a,b)=> a||b))
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
        console.log("getAccount", address.toString())

        const store = this.storage.get(address_ser(address));
        if (store === undefined) {
            const store = new SMData(undefined)
            this.storage.set(address_ser(address), store);
            return Promise.resolve(store.account)
        }
        return Promise.resolve(store.account);
    }

    getContractCode(address: Address): Promise<Buffer> {
        console.log("getContractCode")

        const store = this.storage.get(address_ser(address));
        if (store === undefined) return Promise.reject();
        return Promise.resolve(store.code);
    }

    getContractStorage(address: Address, key: Buffer): Promise<Buffer> {
        console.log(address, key)

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
        console.log("putAccount")

        this.storage.set(address_ser(address), new SMData(account));
        return Promise.resolve()
    }

    putContractCode(address: Address, value: Buffer): Promise<void> {
        console.log("putContractCode")

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
        console.log("putContractStorage", address, key, value)
        console.trace("Here I am!")

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

const get_contract_info = async (contracts: {prefix: string}[], stateManager: StateManager) : Promise<{ contract_info_arr: ContractInfo[], baseEEI: EEI, corpus: corpus_t }>=> {
    const blockchain = await Blockchain.create()
    const baseEEI = new EEI(stateManager, common, blockchain);
    // set up corpus
    let corpus: corpus_t = [];

    // deploy contracts
    let contract_info_arr: ContractInfo[] = [];

    for (let i = 0; i < contracts.length; i++) {
        const currentContract = contracts[i].prefix;
        const info = await deploy_contract(
            new Address(Buffer.from("0000000000000000000000000000000000000001", "hex")),
            Buffer.from(fs.readFileSync(`${currentContract}.bin`).toString(), "hex"),
            baseEEI
        );
        const abi = JSON.parse(fs.readFileSync(`${currentContract}.abi`).toString());
        let {ctx, oracle} = parse_abi(abi);
        info.Ctx = ctx;
        info.Oracle = oracle;
        info.Web3Instance = new web3.eth.Contract(abi);

        contract_info_arr.push(info);

        // init corpus
        info.Ctx.methods.forEach(v => {
            corpus.push({
                contract: info,
                method: v.name,
                args: v.abis,
                eei: baseEEI,
                idx: i
            })
        })
    }

    return {contract_info_arr, baseEEI, corpus}
}


const fuzz_loop = async (contracts: {prefix: string}[], length=0,
                         bug_handler: ((oracle_name: string, txn: string) => Promise<void>) | null = null,
                         testcase_handler: ((txn: string, dag: dag_t) => Promise<void>) | null = null,
                         testcases: string[] | undefined = undefined) : Promise<FuzzResult> => {
    // let trie = new FuzzTrie({
    //   db: new FuzzDB(),
    //   useNodePruning: true
    // });
    const stateManager = new FuzzStateManager();

    let known_dags: string[][] = [];

    let {contract_info_arr, baseEEI, corpus} = await get_contract_info(contracts, stateManager);

    if (testcases !== undefined) {
        for (let i = 0; i < testcases.length; i++) {
            const result = await rerun(JSON.stringify({
                txn: testcases[i]
            }), contracts);
            if (result === null) {
                continue;
            }
            const {dag, abis, eei} = result;
            known_dags.push(serialize_transitions(dag));
            let txn = JSON.parse(testcases[i]);
            corpus.push({
                contract: contract_info_arr[txn.idx],
                method: txn.method,
                args: abis,
                eei: eei,
                idx: txn.idx
            });
        }
    }

    let eei_queue: eei_queue_t = [];
    eei_queue.push({
        eei: baseEEI,
        priority: 1
    })

    let coverage_map: string[] = known_dags.flat(1) || [];


    let exec = 0;
    let fuzzStart = Date.now();
    let iterStart = Date.now();
    let allFoundTestcases: string[]  = [];
    let allFoundVulns: {[key: string]: string} = {};
    const epoch_size =5000;


    while (1) {
        exec += 1;
        if (exec % epoch_size === 0) {
            const current = Date.now();
            let elapsed = current - iterStart;
            if (length > 0 && current - fuzzStart > length) {
                break
            }
            console.log(elapsed, epoch_size / elapsed * 1000, "exec / s - total", exec);
            iterStart = Date.now();
        }
        // select
        const current_item = corpus[randomInteger(0, corpus.length - 1)];
        const current_args = clone_abis(current_item.args);

        // mutate
        mutate_abis(current_args);

        // make a copy of eei
        const {i: selected_eei_index, eei: selected_eei} = priority_sample(eei_queue);
        const current_eei = selected_eei.copy();

        // run txn
        let caller = to_address(1);

        const {reverted} = await run_transaction(
            caller,
            convert_instance_to_bytes(current_item.contract.Web3Instance, current_item.method, current_args),
            current_eei,
            current_item.contract
        )

        if (reverted) {
            continue
        }

        let {
            violated, oracle_name, dag
        } = await run_oracles(caller, current_eei, current_item.contract, current_item.contract.Web3Instance);


        // check cov
        const serialized_transitions = serialize_transitions(dag);
        const cov_changed = serialized_transitions.map(v => {
            if (coverage_map.includes(v)) return false;
            coverage_map.push(v);
            return true;
        }).reduce((a,b) => a || b, false)

        // handle check
        let serialized_txn = ""
        if ((violated || cov_changed) && !reverted) {
            serialized_txn = JSON.stringify({
                method: current_item.method,
                args: current_args.map(v => v.serialize()),
                sm: stateManager.toJSON(),
                caller: address_ser(caller),
                idx: current_item.idx
            })
        }

        if (violated) {
            console.log("found violation", oracle_name, serialized_txn);
            if (!allFoundVulns[oracle_name]) {
                bug_handler && (await bug_handler(oracle_name, serialized_txn));
                allFoundVulns[oracle_name] = serialized_txn
            } else {
                if (allFoundVulns[oracle_name].length > serialized_txn.length)
                    allFoundVulns[oracle_name] = serialized_txn
            }
        }

        if (cov_changed) {
            corpus.push({
                contract: current_item.contract,
                method: current_item.method,
                args: current_args,
                eei: selected_eei,
                idx: current_item.idx
            })
            testcase_handler && (await testcase_handler(serialized_txn, dag));
            console.log("new coverage for :", JSON.stringify(dag))
            allFoundTestcases.push(serialized_txn)
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


export {
    fuzz_loop,
    rerun,
    parse_abi,
    serialize_transitions,
    dag_t,
}