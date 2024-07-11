class Finder<Data> {
    
    public data: Data[];
    
    public constructor(data: Data[]) {
        this.data = data;
    }
    
    [Symbol.iterator]() {
        return this.data[Symbol.iterator]();
    }
    
    /**
     * This is just for historical reasons
     */
    public toArray() {
        return this.data;
    }
}

export default Finder;
