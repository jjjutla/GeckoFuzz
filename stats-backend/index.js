const express = require('express');
const cors = require('cors');
const Protocol = require("../../protocol_v1/contracts/protocols/protocol")
const VVulns = require("../../protocol_v1/contracts/protocols/vvulns")
const {HeartbeatDB, InitDB} = require("../../protocol_v1/db-schema/db")
const app = express()
const port = process.env.PORT || 4001;
const bodyParser = require('body-parser');
const {protocol_address, token_address, vvuln_address, RPC_ADDRESS,  START_FETCH_BLOCK, MAX_PER_FETCH} = require("../../protocol_v1/const")
const Web3 = require("web3")
const fs = require("fs");

let options = {
    inflate: true,
    limit: '100kb',
    type: '*/*'
};
app.use(bodyParser.raw(options));

const corsOptions = {
    origin:'*',
    credentials:true,
    optionSuccessStatus:200,
}
app.use(cors(corsOptions));


all_projects = {}
all_vulns = {}

block_to_ts = {}
let lastBlock = {};

const fetch_timestamp_from_block = async (b) => {
    if (block_to_ts[b] !== undefined) {
        return block_to_ts[b]
    }
    let ts = (await w3.eth.getBlock(b)).timestamp
    block_to_ts[b] = ts
    return ts
}

const max = (a, b) => a > b ? a : b;

w3 = new Web3(new Web3.providers.HttpProvider(RPC_ADDRESS));

const time_skip = 100

const cap_time = (t) => {
    return parseInt(t / time_skip) * time_skip
}


const get_past_event = async (obj, name, cb) => {
    // get latest block
    let latest_block = await w3.eth.getBlockNumber()

    for (let i = lastBlock[name] || START_FETCH_BLOCK; i < latest_block; i += MAX_PER_FETCH) {
        let toBlock = i + MAX_PER_FETCH;
        if (toBlock > latest_block) {
            toBlock = latest_block;
        }
        console.log("fetching from", i, "to", toBlock)

        obj.contract.getPastEvents(name, {fromBlock: i, toBlock}, cb);
    }
}

const collector = async () => {
    const protocol = new Protocol(
        w3, protocol_address, null, fs
    );
    const vvulns = new VVulns(
        w3, vvuln_address, null, fs
    );
    await protocol.init();
    await vvulns.init();
    console.log(`get ppc at ${protocol_address}`)
    for (let i = 0; i < await protocol.GetProjectCount(); i++) {
        console.log("collecting project", i)
        all_projects[i] = Object.assign({}, all_projects[i] || {}, await protocol.GetProjectInfo(i));

        await HeartbeatDB.findAll({
            where: {
                projectId: i
            },
            limit: 1000,
            order: [
                ['timestamp', 'DESC']
            ]
        }).then((res) => {
            all_projects[i].cumulative_heartbeats = {};
            all_projects[i].cumulative_comp = {};
            all_projects[i].heartbeats = res.map((r) => {
                for (let j = 0; j < r.lasting; j+=time_skip) {
                    all_projects[i].cumulative_heartbeats[cap_time(r.timestamp) - j] =
                        (all_projects[i].cumulative_heartbeats[cap_time(r.timestamp) - j] || 0) + 1;
                    all_projects[i].cumulative_comp[cap_time(r.timestamp) - j] =
                        (all_projects[i].cumulative_comp[cap_time(r.timestamp) - j] || 0) + r.allocatedCores;
                }
                return {
                    cores: r.allocatedCores,
                    mem: r.allocatedMem,
                    timestamp: r.timestamp,
                    lasting: r.lasting
                }
            })
        })


    }
    // for (let i = 0; i < await vvulns.nonce(); i++) {
    //     const projectId = await vvulns.projectId(i);
    //     all_vulns[i] = {
    //         ipfsHash: await vvulns.ipfsHash(i),
    //         rewards: await vvulns.rewards(i),
    //         projectId,
    //     };
    //     if (!all_projects[projectId].vulns) {
    //         all_projects[projectId].vulns = Set();
    //     }
    //     all_projects[projectId].vulns.add(i);
    // }

    await get_past_event(protocol, "allEvents",
        async (err, events) => {
            if (err !== null) {
                console.log(err)

                process.exit(-1)
            }

            console.log(`got ${events.length} events`)

            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                if (event.event === "ProjectDeployed") {
                    const project_id = event.returnValues.projectId;
                    all_projects[project_id] = Object.assign({}, all_projects[project_id] || {}, {
                        block: event.blockNumber,
                        time: await fetch_timestamp_from_block(event.blockNumber)
                        // address: event.address,
                    });
                } else if (event.event.startsWith("Project") || event.event === "RewardUpdated") {
                    const project_id = event.returnValues.projectId;
                    all_projects[project_id].logs = [...(all_projects[project_id].logs || []), {
                        event: event.event,
                        block: event.blockNumber,
                        value: event.returnValues,
                        time: await fetch_timestamp_from_block(event.blockNumber)
                    }];
                }
                lastBlock["protocol"] = max(lastBlock["protocol"] || 0, event.blockNumber);
        }

    });

    await get_past_event(vvulns, "Minted",
        async (err, events) => {
            if (err !== null) {
                console.log(err)
                process.exit(-1)
            }

            console.log(`got ${events.length} vvulns events`)

            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                if (event.event === "Minted") {
                    const project_id = event.returnValues.projectId;
                    const tokenId = event.returnValues.tokenId;
                    console.log(event.returnValues)
                    all_vulns[tokenId] = {
                        ipfsHash: event.returnValues.ipfsHash,
                        rewards: event.returnValues.reward,
                        projectId: project_id,
                    };
                    if (!all_projects[project_id]) continue;
                    if (all_projects[project_id].vulns === undefined) {
                        all_projects[project_id].vulns = {};
                    }
                    all_projects[project_id].vulns[tokenId] = {
                        ipfsHash: event.returnValues.ipfsHash,
                        rewards: event.returnValues.reward,
                    };
                }
                lastBlock["vvulns"] = max(lastBlock["vvulns"] || 0, event.blockNumber);
            }

    });




}

app.get('/projects', async (req, res) => {
    return res.send(all_projects);
})

app.get('/project/:id', async (req, res) => {
    return res.send(all_projects[req.params.id]);
})

app.get('/vulnerability/:id', async (req, res) => {
    return res.send(all_vulns[req.params.id]);
})


app.listen(port, async () => {
    console.log(`stats gateway listening on port ${port}`);
    await InitDB();
    while (1) {
        await collector();
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
})
