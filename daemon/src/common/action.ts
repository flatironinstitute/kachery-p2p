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
            console.info(`${actionName} ${actionData}`);
        }
        await operation()
    }
    catch(err) {
        console.warn(err)
        if (onError) {
            await onError(err);
        }
    }
}