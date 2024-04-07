const {DataTypes, Sequelize} = require("sequelize");
const {MYSQL_HOST, MYSQL_USER, MYSQL_DB, MYSQL_PASSWORD} = require("../const");
const sequelize = new Sequelize(`mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@${MYSQL_HOST}:3306/${MYSQL_DB}`);

const HeartbeatDB = sequelize.define('Heartbeat', {
    projectId: DataTypes.STRING,
    allocatedCores: DataTypes.INTEGER,
    allocatedMem: DataTypes.INTEGER,
    timestamp: DataTypes.INTEGER,
    lasting: DataTypes.INTEGER,
    publicKey: DataTypes.STRING,
});

const TestcaseDB = sequelize.define('Testcase', {
    projectId: DataTypes.STRING,
    dag: DataTypes.STRING,
    submitter: DataTypes.STRING,
    cid: DataTypes.STRING,
    power: DataTypes.INTEGER,
});

// all should be valid
const VulnDB = sequelize.define('Vuln', {
    projectId: DataTypes.STRING,
    submitter: DataTypes.STRING,
    cid: DataTypes.STRING,
    rewards: DataTypes.INTEGER,
});

const VoteDB = sequelize.define('Vote', {
    testcaseId: DataTypes.INTEGER,
    voter: DataTypes.STRING,
    validity: DataTypes.BOOLEAN,
});

const DagDB = sequelize.define('Dag', {
    testcaseId: DataTypes.INTEGER,
    src: DataTypes.INTEGER,
    dst: DataTypes.INTEGER,
});


const InitDB = async () => {
    await HeartbeatDB.sync();
    await TestcaseDB.sync();
    await VulnDB.sync();
    await VoteDB.sync();
    await DagDB.sync();
};

module.exports = {HeartbeatDB, TestcaseDB, VoteDB, VulnDB, DagDB, InitDB}