interface ListenerMap<K, V> {
	emit(event: "change", value: V, oldValue: V | null): boolean;
	on(event: "change", listener: (value: V, oldValue: V | null) => void): this;
}

class ListenerMap<K, V> extends Map<K, V> {
	private _listeners: Map<string, Set<Function>> = new Map();

	public on(event: string, listener: Function): this {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, new Set());
		}

		this._listeners.get(event)!.add(listener);

		return this;
	}

	public emit(event: string, ...args: any[]): boolean {
		if (!this._listeners.has(event)) {
			return false;
		}

		for (const listener of this._listeners.get(event)!) {
			listener(...args);
		}

		return true;
	}

	public override set(key: K, value: V): this {
		const oldValue = super.get(key);
		super.set(key, value);
		this.emit("change", value, oldValue);
		return this;
	}

	public override delete(key: K): boolean {
		const oldValue = super.get(key);
		const result = super.delete(key);
		this.emit("change", undefined, oldValue);
		return result;
	}
}

export default ListenerMap;
