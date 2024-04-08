const express = require('express');
const cors = require('cors');
const sevenBin = require('7zip-bin')
const {extractFull} = require('node-7z')
const fetch = require('node-fetch')
const fs = require("fs")

const app = express()
const port = process.env.PORT || 4001;
const bodyParser = require('body-parser');
const {IPFS_GW_API} = require("../../protocol_v1/const");

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


const download_from_ipfs = async (cid) => {
    const response = await fetch(`${IPFS_GW_API}/${cid}`);
    const result = await response.json();
    return Buffer.from(result.data, 'base64');
}

app.get('/:cid', async (req, res) => {
    let p = new Promise(async (resolve, reject) => {
        try {
            const data = await download_from_ipfs(req.params.cid);
            if (data.length === 0) {
                return resolve(res.send({
                    success: 0,
                    data: "not found"
                }));
            }
            const save_path = `/tmp/${Buffer.from(req.params.cid).toString('hex')}`;
            fs.writeFileSync(save_path, data)
            const extract_path = `${save_path}.extracted/`;
            const seven = await extractFull(save_path, extract_path, {
                $bin: sevenBin.path7za
            })

            seven.on('end', () => {
                // list directory
                fs.readdir(extract_path, (err, files) => {
                    if (err) {
                        resolve(res.send({
                            success: 0,
                            data: err
                        }));
                    }
                    let cost = 0;
                    const data = files.filter(file => file.endsWith('.bin')).map(file => {
                        const file_path = `${extract_path}/${file}`;
                        const file_data = Buffer.from(fs.readFileSync(file_path).toString(), "hex");
                        const cf_instructions = file_data.filter((item) => item === 0x57).length;
                        console.log(`${file}: Control flow instruction count = ${cf_instructions} instructions = ${file_data.length}`);

                        cost += Math.pow(cf_instructions * 1000 + file_data.length * 15, 0.8);
                        if (cost > 1e5) cost /= 1e5 + (cost - 1e5) * 0.5;
                        return {
                            cf_instructions,
                            instructions: file_data.length,
                            file
                        }
                    })
                    resolve(res.send({
                        success: 1,
                        data, cost
                    }));
                })
            })

            seven.on("error", (err) => {
                console.log(err)
            })

        } catch (error) {
            console.log(error);
            resolve(res.send({
                success: 0,
                data: ""
            }));
        }
    });

    return await p;
})

app.listen(port, () => {
    console.log(`ipfs gateway listening on port ${port}`)
})
