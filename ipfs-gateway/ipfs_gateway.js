const { create } = require('ipfs-http-client');

const express = require('express');
const cors = require('cors');

const app = express()
const port = process.env.PORT || 4000;
const bodyParser = require('body-parser');
const multer  = require('multer')
const upload = multer({ dest: 'uploads/' })



let options = {
    inflate: true,
    limit: '50mb',
    type: '*/*'
};
app.use(bodyParser.raw(options));

const corsOptions = {
    origin:'*',
    credentials:true,
    optionSuccessStatus:200,
}
app.use(cors(corsOptions));


const get_ipfs_client = () => {
    const projectId = "[REPLACE ME]"
    const projectSecret = "[REPLACE ME]"
    const auth = "Basic " + Buffer.from(projectId + ":" + projectSecret).toString("base64");

    return create({
        host: "ipfs.infura.io", port: 5001, protocol: "https", headers: {
            authorization: auth,
        },
    })
}

const upload_to_ipfs = async (buffer) => {
    const client = get_ipfs_client();
    const { cid } = await client.add(buffer);
    return cid.toString();
}

const download_from_ipfs = async (cid) => {
    const client = get_ipfs_client();
    let data = Buffer.from("");
    for await (const chunk of client.cat(cid)) {
        data = Buffer.concat([data, chunk]);
    }
    return data
}


app.post('/file', upload.single('file'), async (req, res) => {
    console.log(req.file)
    const cid = await upload_to_ipfs(req.file.buffer);
    res.send({
        success: 0,
        cid
    });
})


app.post('/', async (req, res) => {
    console.log(req.body);
    if (!req.body) {
        return res.send({
            success: 0,
            cid: ""
        });
    }
    const cid = await upload_to_ipfs(req.body);
    res.set('Access-Control-Allow-Origin', '*');
    return res.send({
        success: 1,
        cid
    });
})

app.get('/:cid', async (req, res) => {
    console.log(req.params.cid);

    try {
        const data = await download_from_ipfs(req.params.cid);
        res.set('Access-Control-Allow-Origin', '*');
        return res.send({
            success: 1,
            data: data.toString()
        });
    } catch (error) {
        console.log(error);
        return res.send({
            success: 0,
            data: ""
        });
    }
})


app.get('/:cid/hex', async (req, res) => {
    console.log(req.params.cid);

    try {
        const data = await download_from_ipfs(req.params.cid);
        res.set('Access-Control-Allow-Origin', '*');
        return res.send({
            success: 1,
            data: data.toString('hex')
        });
    } catch (error) {
        console.log(error);
        return res.send({
            success: 0,
            data: ""
        });
    }
})

app.listen(port, () => {
    console.log(`ipfs gateway listening on port ${port}`)
})
