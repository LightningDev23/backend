class HTTPErrors {
	public code: number;
	public errors: Record<string, any>;

	constructor(code: number) {
		this.code = code;
		this.errors = {};
	}

	public addError(error: Record<string, any>): void {
		for (const [key, value] of Object.entries(error)) {
			if (Array.isArray(value)) {
				for (const [index, item] of value.entries()) {
					if (this.errors[key]) {
						this.errors[key][index] = item;
					} else {
						this.errors[key] = { [index]: item };
					}
				}
			} else {
				this.errors[key] = value;
			}
		}
	}

	public toJSON(): { code: number; errors: Record<string, any> } {
		return {
			code: this.code,
			errors: this.errors,
		};
	}

	public toString(): string {
		return JSON.stringify(this.toJSON());
	}

	public clearErrors(): void {
		this.errors = {};
	}

	public clearError(errorName: string): void {
		this.errors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== errorName));
	}

	public hasErrors(): boolean {
		return Object.keys(this.errors).length > 0;
	}
}

export default HTTPErrors;
