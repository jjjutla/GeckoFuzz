import * as fs from "fs";
import {create, IPFSHTTPClient, Options} from 'ipfs-http-client'
import {fuzz_loop, rerun, dag_t, parse_abi, serialize_transitions} from './src/full/fuzzer'
// @ts-ignore
import fetch from 'node-fetch';

// @ts-ignore
import * as prompt from "prompt-sync";
// @ts-ignore
import Protocol from "../../protocol_v1/contracts/protocols/protocol"
// @ts-ignore
import Token from "../../protocol_v1/contracts/protocols/token"
// @ts-ignore
import UVulns from "../../protocol_v1/contracts/protocols/uvulns"
import Web3 from "web3";
import {Account} from "web3-core";
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';

// @ts-ignore
import TestcaseClient from "../telemetry-backend/testcase_client";
// @ts-ignore
import HeartbeatClient from "../telemetry-backend/heartbeat_client";

const TOKEN = "ETH"
const MIN_BALANCE = 0.05;
let ACCOUNT: null | Account = null;
let WEB3: Web3 | null = null;

let IPFS_PROVIDER = "http://"
const MIN_STAKE_AMT = 1000;
const {protocol_address, token_address, uvuln_address, IPFS_GW_API, RPC_ADDRESS, START_FETCH_BLOCK, MAX_PER_FETCH} = require("../const")


const get_past_event = async (obj: any, name: string, cb: any): Promise<null[]> => {
    if (WEB3 === null) {
        // @ts-ignore
        return new Promise()
    }
    // get latest block

    let all_events: null[] = []
    let latest_block = await WEB3.eth.getBlockNumber()

    for (let i = lastBlock[name] || START_FETCH_BLOCK; i < latest_block; i += MAX_PER_FETCH) {
        let toBlock = i + MAX_PER_FETCH;
        if (toBlock > latest_block) {
            toBlock = latest_block;
        }
        console.log("fetching from", i, "to", toBlock)

        all_events.push(obj.contract.getPastEvents(name, {fromBlock: i, toBlock}, cb));
    }
    return Promise.all(all_events)
}

const get_ipfs_client = () : IPFSHTTPClient => {
    const projectId = "2FRllLCZ1wwOMKsL18c9WhovfsK"
    const projectSecret = "0f35bd951bb27bd39c7d30a5c24c8a30"
    const auth = "Basic " + Buffer.from(projectId + ":" + projectSecret).toString("base64");

    return create({
        host: "ipfs.infura.io", port: 5001, protocol: "https", headers: {
            authorization: auth,
        },
    })
    // const client = create({
    //     host: '10.0.0.149',
    //     port: 5001,
    //     protocol: 'http',
    // })
}

const upload_to_ipfs = async (buffer: Buffer): Promise<string> => {
    // const client = get_ipfs_client();
    // const { cid } = await client.add(buffer);
    // return cid.toString();
    console.log("uploading to ipfs")
    const requestOptions = {
        method: "POST",
        headers: { "FuzzLand-Source": "Onboarding" },
        body: buffer.toString()
    };
    const response = await fetch(`${IPFS_GW_API}`, requestOptions);
    const result: any = await response.json();
    return result.cid;
}

const download_from_ipfs = async (cid: string): Promise<Buffer> => {
    const response = await fetch(`${IPFS_GW_API}/${cid}`);
    const result: any = await response.json();
    return result.data;
}

const onboard = async (directory: string) => {
    // enumerate through directory and find onboardable projects
    fs.readdir(directory, async (err, files) => {
        let bins = files.filter(file => {
            return file.endsWith(".bin")
        });

        let abis = files.filter(file => {
            return file.endsWith(".abi")
        });

        if (bins.length !== 1 && abis.length !== 1) {
            console.log(`Currently only support one contract (bin, abi) pair. Remove irrelevent *.bin or *.abi files in ${directory}.`)
            return;
        }

        if (bins[0].replace(".bin", "") !== abis[0].replace(".abi", "")){
            console.log("Prefix not match for ", bins[0], abis[0])
            return
        }

        const prefix = directory + '/' + bins[0].replace(".bin", "")

        // todo: run fuzzing for x mins
        console.log("fuzzing for 10s to find all low hanging fruits!")
        const {allFoundVulns, allFoundTestcases} = await fuzz_loop([{prefix}], 100);

        console.log(allFoundVulns)

        if (Object.keys(allFoundVulns).length > 0) {
            console.log("Oracle violated! Please fix the issue before onboarding", allFoundVulns)
            process.exit(-1)
        }

        const program_data = Buffer.from(Buffer.from(JSON.stringify({
            a: fs.readFileSync(`${prefix}.abi`).toString("hex"),
            b: fs.readFileSync(`${prefix}.bin`).toString("hex"),
            t: allFoundTestcases,
        })).toString("hex"));

        const cid = await upload_to_ipfs(program_data);

        const testcase_data = Buffer.from(Buffer.from(JSON.stringify({
            a: allFoundTestcases,
        })))
        const testcase_cid = await upload_to_ipfs(testcase_data);

        console.log("uploaded to ipfs", cid, "testcase", testcase_cid)
        const abi_parsed = parse_abi(
            JSON.parse(
                fs.readFileSync(`${prefix}.abi`).toString("utf-8")
            )
        );
        // ask about rewards
        // const abi = JSON.parse(fs.readFileSync(`${prefix}.abi`).toString())
        // const oracle_methods = abi.filter((v: ABIInput) =>
        //   v.type === "function" && (v.name.startsWith("echidna") || v.name.startsWith("lightfuzz"))
        // ).map((v: ABIInput) => v.name)
        //
        //
        // const rewards = oracle_methods.map((v: string) => {
        //   const reward_percentage = prompt('What is reward percentage (no need to put %)? ')
        //   return {
        //     name: v,
        //     reward_percentage: parseFloat(reward_percentage),
        //   }
        // })

        // todo: upload allFoundTestcases to ipfs

        const onboarding = {
            f: cid,
            tc: testcase_cid,
            oracles: abi_parsed.oracle.methods.map((v: {name: string}) => {
                return v.name;
            })
        };
        console.log("onboarding", onboarding);
        console.log(Buffer.from(JSON.stringify(onboarding)).toString("base64"));
    });
}

const get_balance = async (web3: Web3, account: Account) : Promise<number> => {
    return parseFloat(web3.utils.fromWei(await web3.eth.getBalance(account.address)));
}

const ensure_greater_balance = async (web3: Web3, account: Account) => {
    console.log("Checking balance", await get_balance(web3, account))
    if (await get_balance(web3, account) < MIN_BALANCE) {
        console.log("Not enough balance, please fund your account", account.address, "with at least", MIN_BALANCE, TOKEN);
        process.exit(-1);
    }
}

const use_or_create_private_key_from_argv = async (web3: Web3, argv: {private_key: string}) => {
    let account: null | Account = null;
    if (argv.private_key) {
        account = web3.eth.accounts.privateKeyToAccount(argv.private_key);
        console.log(`Using private key from command line (address: ${account.address})`);
    }
    if (!account && fs.existsSync("~/.fuzzland/privatekey.json")) {
        const config = JSON.parse(fs.readFileSync("~/.fuzzland/privatekey.json").toString());
        account = web3.eth.accounts.privateKeyToAccount(config.private_key);
        console.log(`Using private key from ~/.fuzzland/privatekey.json (address: ${account.address})`);
    }
    if (!account) {
        account = web3.eth.accounts.create();
        console.log(`Created new private key (address: ${account.address})`);
        fs.mkdirSync("~/.fuzzland", {recursive: true, mode: 0o700, });

        fs.writeFileSync("~/.fuzzland/privatekey.json", JSON.stringify({private_key: account.privateKey}));
    }

    await ensure_greater_balance(web3, account);
    ACCOUNT = account;
}

const get_web3_from_argv = (argv: {provider: string}) => {
    WEB3 = new Web3(new Web3.providers.HttpProvider(argv.provider || RPC_ADDRESS));
}


const to_oracle_id = (oracle_name: string) : number => {
    let hash = 0,
        i, chr;
    if (oracle_name.length === 0) return hash;
    for (i = 0; i < oracle_name.length; i++) {
        chr = oracle_name.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash < 0 ? -hash : hash;
}

const download_from_project_info = async (project_hash: string): Promise<{ directory: string, prefix: string, testcases: string[] }> => {
    const directory = `./.fuzzland/${uuidv4()}/`;
    const prefix = `${directory}/1`;
    fs.mkdirSync(prefix, {recursive: true, mode: 0o700, });

    // download the contract
    const ipfs_info = await download_from_ipfs(project_hash)//project_hash
    const contract_info = JSON.parse(Buffer.from(ipfs_info.toString(), "hex").toString());
    const abi_content = Buffer.from(contract_info.a, "hex").toString();
    const bin_content = Buffer.from(contract_info.b, "hex").toString();

    fs.writeFileSync(`${prefix}.abi`, abi_content);
    fs.writeFileSync(`${prefix}.bin`, bin_content);

    console.log(contract_info)
    return {directory, prefix, testcases: contract_info.t};
}

const calculate_miner_rewards = async (protocol: Protocol, oracle_name: string, project_id: number) => {
    if (await protocol.IsOracleFreezed(project_id, to_oracle_id(oracle_name))) {
        return 0;
    }
    const result = await protocol.GetProjectInfo(project_id);
    const reward_allocation = JSON.parse((await download_from_ipfs(result.splittings)).toString());
    return reward_allocation[oracle_name] * result.base_reward || 0;
}

const miner = async () => {
    const protocol = new Protocol(WEB3, protocol_address, ACCOUNT, fs);
    await protocol.init();

    let reported = new Set();


    const uvulns = new UVulns(WEB3, uvuln_address, ACCOUNT, fs);
    await uvulns.init()
    // pull all projects
    while (1) {
        const projects = [];
        for (let i = 0; i < await protocol.GetProjectCount(); i++) {
            const project_info = await protocol.GetProjectInfo(i);

            // @ts-ignore
            projects.push({
                // @ts-ignore
                id: i,
                // @ts-ignore
                info: project_info,
                // @ts-ignore
                status: project_info.status === '0'
            });
        }
        // console.log(projects)
        // randomly select one project
        let tried = 0;
        let selected_project_id = -1;
        while (tried < 10) {
            selected_project_id = Math.floor(Math.random() * projects.length);
            // @ts-ignore
            if (projects[selected_project_id].status) {
                break
            }
            tried++;

        }
        if (tried == 10) {
            console.log("All projects are frozen, waiting for new projects");
            continue;
        }
        const project = projects[selected_project_id];


        // @ts-ignore
        console.log("Selected project", project.id)

        // @ts-ignore
        const {directory, prefix, testcases} = await download_from_project_info(project.info.ipfsHash);
        let start = (new Date().getTime()) / 1000;

        // start fuzzing
        await fuzz_loop([{prefix}], 100000, async (oracle_name: string, txn: string) => {
            // if bug found
            // create txn {testcase, project, sig} and send
            console.log("Found bug", oracle_name, txn);
            if (reported.has(`${selected_project_id}@${oracle_name}`)) {
                return;
            }

            reported.add(`${selected_project_id}@${oracle_name}`);
            let cid = await upload_to_ipfs(Buffer.from(JSON.stringify({
                txn, oracle_name
            })))
            // create txn {testcase, project, sig} and send
            console.log("uploaded to ipfs", cid);
            const reward = await calculate_miner_rewards(protocol, oracle_name, selected_project_id);
            if (reward > 0) {
                console.log(reward, to_oracle_id(oracle_name))
                await uvulns.mint(ACCOUNT?.address, cid, selected_project_id, BigInt(reward), to_oracle_id(oracle_name));
            } else {
                console.log("No reward for this oracle", oracle_name);
            }
        }, async (txn: string, dag: dag_t) => {
            // on new testcase found
            // upload to ipfs
            // console.log("New testcase found", txn);
            // const cid = await upload_to_ipfs(Buffer.from(JSON.stringify({
            //     txn, dag
            // })))
            // console.log("uploaded to ipfs", cid);
            // await TestcaseClient.Submit(ACCOUNT, selected_project_id, cid, JSON.stringify(dag), 1);
            // console.log("Submitted to oracle", cid);
        }, testcases);
        await HeartbeatClient.Heartbeat(
            ACCOUNT?.address,
            selected_project_id,
            1,
            1,
            (new Date().getTime() / 1000 - start),
        );
    }

}
// console.log(p)
const rerun_p = async (input: string, prefix: string) => {
    await rerun(JSON.stringify({
        txn: input,
        oracle: ""
    }), [{prefix: prefix}])
}

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const max = (a: number, b: number) => a > b ? a : b;

let lastBlock = {
    "uvulns": 0
};


const check_and_vote = async (
    protocol: Protocol,
    project_id: number,
    ipfs_hash: string,
    project_ipfs_hash: string,
    oracle_id: number,
    rewards: number) => {
    const {directory, prefix} = await download_from_project_info(project_ipfs_hash);
    const result = await rerun((await download_from_ipfs(ipfs_hash)).toString(), [{prefix}]);
    // console.log(1, result)
    if (!result) return false;
    const {oracle: violated_oracle} = result;
    // console.log(2, violated_oracle)
    if (!violated_oracle) return false;
    // console.log(3, to_oracle_id(violated_oracle) , oracle_id)
    if (to_oracle_id(violated_oracle) != oracle_id) return false;
    // console.log(4, rewards, await calculate_miner_rewards(protocol, violated_oracle, project_id))
    if (rewards <= 0 || rewards != await calculate_miner_rewards(protocol, violated_oracle, project_id)) return false;
    return true;
}

const check_staker = async (protocol: Protocol) => {
    console.log("Checking staking status");
    if (!await protocol.IsStaker(ACCOUNT?.address)) {
        console.log(`Not a staker, send ${MIN_STAKE_AMT} FUZL to ${ACCOUNT?.address} and run '${process.argv[0]} stake' to stake first`);
        process.exit(1);
    }
    console.log("Staking status checked. You are in consensus group.");
}


const stake = async (amt: number | undefined) => {
    const token = new Token(WEB3, token_address, ACCOUNT, fs);
    await token.init();


    console.log(token_address, ACCOUNT?.address, protocol_address)
    const real_amt = (amt || MIN_STAKE_AMT) + 1;

    const allowance = BigInt(await token.allowance(ACCOUNT?.address, protocol_address));
    console.log("Allowance", allowance);

    if (allowance < BigInt(real_amt) * BigInt(10 ** 18)) {
        const needed_approval = BigInt((amt || MIN_STAKE_AMT) + 1) - allowance / BigInt(10 ** 18);
        console.log(`Approving ${protocol_address} from ${ACCOUNT?.address} with ${needed_approval} FUZL`);
        await token.approve(protocol_address, needed_approval * BigInt(10 ** 18));
        console.log("Approved!");
    }


    const protocol = new Protocol(WEB3, protocol_address, ACCOUNT, fs);
    await protocol.init();

    console.log(`Staking ${ACCOUNT?.address} with ${amt || MIN_STAKE_AMT} FUZL`);
    await protocol.Stake(BigInt(real_amt) * BigInt(10 ** 18));
    console.log("Staked!");
}

const validator = async () => {
    const uvulns = new UVulns(WEB3, uvuln_address, ACCOUNT, fs);
    await uvulns.init();
    const protocol = new Protocol(WEB3, protocol_address, ACCOUNT, fs);
    await protocol.init();
    await check_staker(protocol);
    let voted = new Set();
    voted.add('0')

    while (true) {
        // listen on testcase/bug events
        await get_past_event(uvulns, "Minted", async (err: any, events: any) => {
            if (err !== null) {
                console.log("Failed to subscribe to blockchain events due to", err)
                return
            }
            console.log(`got ${events.length} uvulns events since block ${lastBlock["uvulns"] || 0}`)
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                if (event.event === "Minted") {
                    const project_id = event.returnValues.projectId;
                    const token_id = event.returnValues.tokenId;
                    const oracle_id = event.returnValues.oracleId;

                    if (!(await protocol.IsOracleFreezed(project_id, oracle_id))) {
                        if (voted.has(token_id)) {
                            console.log("Already voted", token_id);
                            if (await protocol.IsVoteReady(token_id)) {
                                console.log("Already voted but ready ", token_id);
                                await protocol.VotePostProcessAye(token_id);
                            }
                            continue;
                        }
                        voted.add(token_id);

                        console.log("Oracle is not freezed", project_id, oracle_id);
                        let project_info = await protocol.GetProjectInfo(project_id);

                        let vote = await check_and_vote(
                            protocol,
                            project_id,
                            event.returnValues.ipfsHash,
                            project_info.ipfsHash, oracle_id, event.returnValues.reward);
                        console.log("Vote", vote);
                        if (vote) {
                            try {
                                await protocol.VoteAye(token_id);
                            } catch (e) {
                                console.log("Vote failed", e);
                            }
                            if (await protocol.IsVoteReady(token_id)) {
                                await protocol.VotePostProcessAye(token_id);
                            }
                        } else {
                            await protocol.VoteNay(token_id);
                        }
                    }
                }
                lastBlock["uvulns"] = max(lastBlock["uvulns"] || 0, event.blockNumber);
            }

        });
        await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    // rerun testcase / bug

    // create txn {testcase, project, sig} and send / burn it

}

// void onboard()
yargs(hideBin(process.argv))
    .command('onboard [dir]', 'Generate token for a project required during onboarding on Web UI', (yargs: any) => {
        return yargs
            .positional('dir', {
                describe: 'Directory of the project',
                default: "."
            })

    }, async (argv: {dir: string}) => {
        await onboard(argv.dir);
    })
    .command('miner', 'start the miner', (yargs: any) => {
            return yargs
                .option('private_key', {
                    describe: 'Leave empty to generate a new key or use existing key',
                    default: ""
                })
        },
        async (argv: {private_key: string, provider: string}) => {
            get_web3_from_argv(argv);
            if (WEB3 === null) {
                console.log("Something went wrong, please check your provider");
                process.exit(-1)
            }
            await use_or_create_private_key_from_argv(WEB3, argv);
            await miner();
        })
    .command('validator', 'start the validator', (yargs: any) => {
        return yargs
            .option('private_key', {
                describe: 'Leave empty to generate a new key or use existing key',
            })
    }, async (argv: {private_key: string, provider: string}) => {
        get_web3_from_argv(argv);
        if (WEB3 === null) {
            console.log("Something went wrong, please check your provider");
            process.exit(-1)
        }
        await use_or_create_private_key_from_argv(WEB3, argv);
        await validator();
    })
    .command('rerun', 'rerun a vuln', (yargs: any) => {
    }, async (argv: {input: string, prefix: string}) => {
        await rerun_p(argv.input, argv.prefix);
    })
    .command('stake', 'stake to join consensus group', (yargs: any) => {
        return yargs
            .option('private_key', {
                describe: 'Leave empty to generate a new key or use existing key',
            })
            .option('amount', {
                describe: `Stake amount. Leave empty to use default amount (${MIN_STAKE_AMT} FUZL)`,
            })
    }, async (argv: {private_key: string, provider: string, amount: number | undefined}) => {
        get_web3_from_argv(argv);
        if (WEB3 === null) {
            console.log("Something went wrong, please check your provider");
            process.exit(-1)
        }
        await use_or_create_private_key_from_argv(WEB3, argv);
        await stake(argv.amount);
    })
    .parse()

