import { JSONObject } from "./interfaces/core";

export const action = async (
    actionName: string,
    actionData: any,
    operation: () => Promise<void>,
    onError: ((err: Error) => Promise<void>) | null
) => {
    try {
        console.info(`${actionName} ${actionData}`);
        await operation()
    }
    catch(err) {
        if (onError) {
            await onError(err);
        }
    }
}