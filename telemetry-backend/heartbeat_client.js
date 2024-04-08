const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const {TELEMETRY_API} = require("../../protocol_v1/const");
const PROTO_PATH = "../protos/heartbeatV1.proto";
const options = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
};
const grpcObj = protoLoader.loadSync(PROTO_PATH, options);
const HeartbeatService = grpc.loadPackageDefinition(grpcObj).HeartbeatService;

const clientStub = new HeartbeatService(
    TELEMETRY_API,
    grpc.credentials.createInsecure()
);

function Heartbeat(public_key, project_id, allocated_cores, allocated_mem, lasting) {
    return new Promise((resolve, reject) => {
        clientStub.Heartbeat({
            timestamp: parseInt((new Date()).getTime() / 1000),
            public_key, project_id, allocated_cores, allocated_mem, lasting
        }, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        });
    });
}

module.exports = {
    Heartbeat
}


