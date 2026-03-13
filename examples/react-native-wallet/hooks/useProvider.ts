import {useContext, useEffect} from "react";
import {useStore} from "@tanstack/react-store";

import {AlgorandContext} from "@/providers/ReactNativeProvider";
import {keyStore} from "@/stores/keystore";
import {accountsStore} from "@/stores/accounts";

export function useProvider(){
    const provider = useContext(AlgorandContext);
    if(provider === null) throw new Error('No Provider Found')

    useEffect(() => {
        function beforeGenerate(){
            provider?.log.info('Hooking into before generate', undefined, 'useProvider')
        }
        provider.key.store.hooks.before('generate', beforeGenerate)

        return ()=> {
            provider.key.store.hooks.remove('generate', beforeGenerate)
        }
    }, []);

    // Hydrate the store in the context (React)
    const keys = useStore(keyStore, (state)=>state.keys);
    const status = useStore(keyStore, (state)=>state.status)
    const accounts = useStore(accountsStore, (state)=>state.accounts)

    return {...provider, keys, status, accounts};
}
