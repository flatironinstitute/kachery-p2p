class DownloadOptimizer {
    constructor(jobCreator) {
        this._chunks = {}; // by ID
        this._providers = {}; // by ID
        this._providersForChunks = {}; // by chunkId, by providerId
        this._jobCreator = jobCreator;

        this._maxNumSimultaneousChunkDownloads = 5;

        this._start();
    }
    addChunk(chunkId, info) {
        const c = new Chunk(chunkId, info);
        this._chunks[chunkId] = c;
        return c;
    }
    addProvider(providerId) {
        const pn = new Provider(providerId);
        this._provider[providerId] = pn;
        return pn;
    }
    setProviderForChunk({ chunkId, providerId }) {
        if (!this._providersForChunks[chunkId]) {
            this._providersForChunks[chunkId] = {};
        }
        this._providersForChunks[chunkId][providerId] = true;
    }
    async _start() {
        while (true) {
            let numActiveChunkDownloads = 0;
            for (let chunkId in this._chunks) {
                const chunk = this._chunks[chunkId];
                if (chunk.isDownloading()) {
                    numActiveChunkDownloads++;
                }
            }
            let numActiveChunkDownloads = Object.keys(this._chunks).filter(c => this._chunks[c].isDownloading()).length;
            if (numActiveChunkDownloads < this._maxNumSimultaneousChunkDownloads) {
                for (let chunkId in this._chunks) {
                    const chunk = this._chunks[chunkId];
                    if (numActiveChunkDownloads < this._maxNumSimultaneousChunkDownloads) {
                        const providerCandidates = [];
                        for (let providerId in (this._providersForChunks[chunkId] || {})) {
                            const provider = this._providers[providerId];
                            if (!provider.hasChunkDownloadJob()) {
                                providerCandidates.push(provider);
                            }
                        }
                        const provider = chooseFastestProvider(providerCandidates);
                        if (provider) {
                            const chunkDownloadJob = this._jobCreator.createChunkDownloadJob({ chunkId, providerId }); // todo
                            chunk.setChunkDownloadJob(chunkDownloadJob);
                            provider.setChunkDownloadJob(chunkDownloadJob);
                            numActiveChunkDownloads++;
                        }
                    }
                }
            }
            // in future, only do these checks when something changes
            await sleepMsec(500); // todo
        }
    }
}

const chooseFastestProvider = (providerList) => {
    if (providerList.length === 0) {
        return null;
    }
    const estimatedRates = providerId.map(p => p.estimatedRateBps());
    const bestIndex = argMax(estimatedRates);
    return providerList[bestIndex];
}


// thanks: https://gist.github.com/engelen/fbce4476c9e68c52ff7e5c2da5c24a28
function argMax(array) {
    return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}