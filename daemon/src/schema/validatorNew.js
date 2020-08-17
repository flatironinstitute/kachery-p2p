import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const validator = new Ajv();

const loadSchema = (fileName) => {
    const txt = fs.readFileSync(`${__dirname}/${fileName}`, 'utf-8'); 
    const obj = JSON.parse(txt);
    validator.addSchema(obj, obj['$id']);
}
const fileNames = fs.readdirSync(__dirname);
fileNames.forEach(fileName => {
    if (fileName.endsWith('.json')) {
        loadSchema(fileName);
    }
})

export default validator;