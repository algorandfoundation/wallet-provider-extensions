import Hook, { type HookCollection } from "before-after-hook";

// LifeCycle Hooks
export const cryptoBip39Hooks: HookCollection<
	Record<
		string,
		{
			Options?: any;
			Result?: any;
			Error?: any;
		}
	>,
	string
> = new Hook.Collection();
