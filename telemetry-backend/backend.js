const grpc = require("@grpc/grpc-js");
const {HeartbeatDB, TestcaseDB, VoteDB, DagDB, InitDB} = require("../db-schema/db")
const protoLoader = require("@grpc/proto-loader");
const {Sequelize} = require("sequelize");
const crypto = require('crypto');

const PROTO_PATH_HEARTBEAT = "../protos/heartbeatV1.proto";
const PROTO_PATH_TESTCASE = "../protos/testcaseV1.proto";

const loaderOptions = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
};

const packageDefHeartbeat = protoLoader.loadSync(PROTO_PATH_HEARTBEAT, loaderOptions);
const grpcObjHeartbeat = grpc.loadPackageDefinition(packageDefHeartbeat);

const packageDefTestcase = protoLoader.loadSync(PROTO_PATH_TESTCASE, loaderOptions);
const grpcObjTestcase = grpc.loadPackageDefinition(packageDefTestcase);

const server = new grpc.Server();



function verifySignature(signature, data, pubKey) {
    return true;
}


server.addService(grpcObjHeartbeat.HeartbeatService.service, {
    Heartbeat: (heartbeatReq, callback) => {
        heartbeatReq = heartbeatReq.request
        if (
            verifySignature(heartbeatReq.signature,
                heartbeatReq.project_id + heartbeatReq.timestamp,
                heartbeatReq.public_key)
        ) {
            HeartbeatDB.create({
                publicKey: heartbeatReq.public_key,
                projectId: heartbeatReq.project_id,
                allocatedCores: heartbeatReq.allocated_cores,
                allocatedMem: heartbeatReq.allocated_mem,
                timestamp: heartbeatReq.timestamp,
                lasting: heartbeatReq.lasting,
            }).then(_ => {
                callback(null, {status: 1});
            })

        } else {
            callback(null, {status: 0});
        }
    },
});

const sanitize_dag = (dag) => {
    let pairs = new Set();
    JSON.parse(dag).map(v => {
        pairs.add(v.src + "->" + v.dst);
    });

    const sanitized_dag = Array.from(pairs).sort().map(v => {
        let pair = v.split("->");
        return {
            src: pair[0],
            dst: pair[1]
        }
    });

    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(sanitized_dag));
    return {
        dag: sanitized_dag,
        hash: hash.digest('hex')
    };
}


server.addService(grpcObjTestcase.TestcaseService.service, {
    Submit: (testcaseReq, callback) => {
        testcaseReq = testcaseReq.request
        if (
            verifySignature(testcaseReq.signature,
                testcaseReq.project_id + testcaseReq.cid,
                testcaseReq.public_key)
        ) {
            const {dag, hash} = sanitize_dag(testcaseReq.dag);
            TestcaseDB.create({
                submitter: testcaseReq.public_key,
                projectId: testcaseReq.project_id,
                cid: testcaseReq.cid,
                power: 100000000,
                dag: hash,
            }).then(tc => {
                DagDB.bulkCreate(dag.map((item) => {
                    return {
                        testcaseId: tc.id,
                        src: item.src,
                        dst: item.dst,
                    }
                })).then(_ => {
                    callback(null, {status: 1});
                })
            })

        } else {
            callback(null, {status: 0});
        }
    },
    Vote: (voteReq, callback) => {
        voteReq = voteReq.request
        if (
            verifySignature(voteReq.signature,
                voteReq.testcaseId + voteReq.vote?";1":";0",
                voteReq.public_key)
        ) {
            VoteDB.create({
                testcaseId: voteReq.testcaseId,
                voter: voteReq.public_key,
                validity: voteReq.vote,
            }).then(_ => {
                callback(null, {status: 1});
            })

        } else {
            callback(null, {status: 0});
        }
    },
    Get(getReq, callback) {
        getReq = getReq.request
        TestcaseDB.findAll({
            where: Sequelize.and(
                {projectId: getReq.project_id},
                {id: {gt: getReq.from}}
            )
        }).then(testcases => {
            callback(null, {testcases: testcases.map(testcase => {
                    return {
                        id: testcase.id,
                        cid: testcase.cid,
                        dag: testcase.dag,
                        power: testcase.power,
                    }
                }), status: 1});
        })
    }
});


server.bindAsync(
    "0.0.0.0:50051",
    grpc.ServerCredentials.createInsecure(),
    async (error, port) => {
        await InitDB();
        console.log("Server running at http://127.0.0.1:50051");
        HeartbeatDB.sync().then(r => {
            server.start()
        });

    }
);

