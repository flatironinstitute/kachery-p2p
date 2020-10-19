import crypto from 'crypto'
import fs from 'fs'
import { randomAlphaString } from '../../../common/util'
import { localFilePath, LocalFilePath, Sha1Hash } from '../../../interfaces/core'
import { kacheryStorageDir } from './kachery'

export const concatenateFilesIntoTemporaryFile = async (paths: LocalFilePath[]): Promise<{sha1: Sha1Hash, path: LocalFilePath}> => {
    return new Promise((resolve, reject) => {
        const tmpPath = createTemporaryFilePath({prefix: 'kachery-p2p-concat-'})
        const writeStream = fs.createWriteStream(tmpPath)
        const sha = crypto.createHash('sha1')
        let done = false
        let ii = 0
        const _handleNextFile = () => {
            if (done) return
            if (ii >= paths.length) {
                writeStream.end(() => {
                    if (done) return
                    done = true
                    const sha1 = sha.digest('hex') as any as Sha1Hash
                    resolve({sha1, path: localFilePath(tmpPath)})
                })
                return
            }
            const readStream = fs.createReadStream(paths[ii].toString())
            readStream.on('error', (err) => {
                if (done) return
                done = true
                reject(err)
            })
            readStream.on('data', data => {
                if (done) return
                sha.update(data)
                writeStream.write(data)
            })
            readStream.on('end', () => {
                ii ++
                _handleNextFile()
            })
        }
        _handleNextFile()
    })
}

export const moveFileIntoKacheryStorage = (args: {path: LocalFilePath, sha1: Sha1Hash}) => {
    const s = args.sha1
    const destParentPath = `${kacheryStorageDir()}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}`
    const destPath = `${destParentPath}/${s}`
    if (fs.existsSync(destPath)) {
        fs.unlinkSync(args.path.toString())
        return destPath
    }
    fs.mkdirSync(destParentPath, {recursive: true})
    fs.renameSync(args.path.toString(), destPath)
    return destPath
}

const _getTemporaryDirectory = () => {
    const ret = process.env['KACHERY_STORAGE_DIR'] + '/tmp'
    mkdirIfNeeded(localFilePath(ret))
    return ret
}

const mkdirIfNeeded = (path: LocalFilePath) => {
    if (!fs.existsSync(path.toString())) {
        try {
            fs.mkdirSync(path.toString())
        }
        catch(err) {
            if (!fs.existsSync(path.toString())) {
                fs.mkdirSync(path.toString())
            }
        }
    }
}

export const createTemporaryFilePath = (args: {prefix: string}) => {
    const dirPath = _getTemporaryDirectory()
    return `${dirPath}/${args.prefix}-${randomAlphaString(10)}`
}