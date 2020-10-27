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
            console.info(`${actionName} ${JSON.stringify(actionData)}`);
        }
        await operation()
    }
    catch(err) {
        console.warn(`@@@@@@@@@@@@@@@@@@ Error in ${actionName}: ${err.message}`)
        if (onError) {
            await onError(err);
        }
    }
}