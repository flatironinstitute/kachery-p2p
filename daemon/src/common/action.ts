const _globalData: {verbose: number} = {
    verbose: 0
}

export const action = async (
    actionName: string,
    actionData: any,
    operation: () => Promise<void>,
    onError: ((err: Error) => Promise<void>) | null
) => {
    try {
        if (_globalData.verbose > 0) {
            /* istanbul ignore next */
            console.info(`${actionName}`);
        }
        await operation()
    }
    catch(err) {
        /* istanbul ignore next */
        console.warn(`@@@@@@@@@@@@@@@@@@ Error in ${actionName}: ${err.message}`)
        /* istanbul ignore next */
        if (onError) {
            await onError(err);
        }
    }
}