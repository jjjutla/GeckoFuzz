const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const {TELEMETRY_API} = require("../const");
const PROTO_PATH = "../protos/testcaseV1.proto";
const options = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
};
const grpcObj = protoLoader.loadSync(PROTO_PATH, options);
const TestcaseService = grpc.loadPackageDefinition(grpcObj).TestcaseService;

const clientStub = new TestcaseService(
    TELEMETRY_API,
    grpc.credentials.createInsecure()
);

function sign(key, msg) {
    // todo
    msg.public_key = key.public_key;
    msg.signature = "signature";
    return msg;
}

async function Submit(key, project_id, cid, dag, source) {
    return new Promise((resolve, reject) => {
        console.log("Submit", project_id, cid, dag, source);
        clientStub.Submit(sign(key, {
            project_id,
            cid,
            dag,
            source
        }), (error, status) => {
            console.log("Submit", error, status);
            if (error) {
                reject(error);
            } else {
                resolve(status);
            }
        });
    });
}

async function Vote(key, testcase_id, vote) {
    return new Promise((resolve, reject) => {
        clientStub.Submit(sign(key, {
            testcase_id,
            vote,
        }), (error, status) => {
            if (error) {
                reject(error);
            } else {
                resolve(status);
            }
        });
    });

}

async function Get(project_id, from=0) {
    return new Promise((resolve, reject) => {
        clientStub.Get({
            project_id,
            from,
        }, (error, status) => {
            if (error) {
                reject(error);
            } else {
                resolve(status);
            }
        });
    });
}

module.exports = {Submit, Vote, Get};
