export const initializeLog = (feedManager, {verbose, categoryOpts}) => {
    globalData.log.initialize(feedManager, {verbose, categoryOpts});
}

export const log = (category) => {
    const x = globalData.log;
    return {
        debug: (name, data, opts) => x.debug(category, name, data, opts),
        info: (name, data, opts) => x.info(category, name, data, opts),
        warning: (name, data, opts) => x.warning(category, name, data, opts),
        error: (name, data, opts) => x.error(category, name, data, opts)
    };
}

class Log {
    constructor() {
        this._feedManager = null;
        this._initialized = false;
        this._queuedMessages = [];
        this._feedId = null;
    }
    async initialize(feedManager, {verbose, categoryOpts}) {
        this._feedManager = feedManager;
        this._verbose = verbose;
        this._categoryOpts = categoryOpts;
        const feedName = 'kachery-p2p-daemon-log';
        this._feedId = await this._feedManager.getFeedId({feedName});
        if (!this._feedId) {
            this._feedId = await this._feedManager.createFeed({feedName})
        }
        this._initialized = true;
        const qm = this._queuedMessages;
        this._queuedMessages = [];
        for (let x of qm) {
            this.append(x.type, x.category, x.name, x.data, x.opts);
        }
    }
    debug(category, name, data, opts) {
        this.append('debug', category, name, data, opts);
    }
    info(category, name, data, opts) {
        this.append('info', category, name, data, opts);
    }
    warning(category, name, data, opts) {
        this.append('warning', category, name, data, opts);
    }
    error(category, name, data, opts) {
        this.append('error', category, name, data, opts);
    }
    critical(category, name, data, opts) {
        this.append('critical', category, name, data, opts);
    }
    append(type, category, name, data, opts) {
        category = category || 'default';
        opts = opts || {};
        data = data || {};
        if (!this._initialized) {
            this._queuedMessages.push({type, category, name, data, opts});
            return;
        }
        let print = opts.print || false;

        let verbose = this._verbose;
        if (category in this._categoryOpts) {
            if ('verbose' in this._categoryOpts[category]) {
                verbose = this._categoryOpts[category].verbose;
            }
        }

        if (type === 'debug') {
            if (verbose >= 0) print = true;
        }
        else if (type === 'error') {
            if (verbose >= 1) print = true;
        }
        else if (type === 'warning') {
            if (verbose >= 2) print = true;
        }
        else if (type === 'info') {
            if (verbose >= 3) print = true;
        }
        if (print) {
            const txt = `[${type}] ${category === 'default' ? "" : "<" + category + "> "}${name} ${JSON.stringify(data)}`;
            if (type === 'debug') {
                console.log (txt);
            }
            else if (type === 'error') {
                console.error(txt);
            }
            else if (type === 'warning') {
                console.warn(txt);
            }
            else {
                console.info(txt);
            }
        }
        this._feedManager.appendMessages({
            feedId: this._feedId,
            subfeedName: category,
            messages: [{type, category, name, data}]
        });
    }
}

const globalData = {
    log: new Log()
}