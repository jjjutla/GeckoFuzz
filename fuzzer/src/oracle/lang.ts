

class Condition {
    constructor(public readonly condition: string) {

    }
}

class State {

}

class Oracle {
    private name: string;
    public pre_condition: Condition[] = [];
    public post_condition: Condition[] = [];
    constructor(name: string) {
        this.name = name;
    }

    after(cond: Condition): Oracle {
        this.pre_condition.push(cond);
        return this;
    }

    should(cond: Condition): Oracle {
        this.post_condition.push(cond);
        return this;
    }

    always(cond: Condition): Oracle {
        this.pre_condition.push(cond);
        this.post_condition.push(cond);
        return this;
    }
}


class Method {
    private name: string = ""
    constructor(name: string) {
        this.name = name;
    }

    called_by(acc: Account): Condition {
        return new Condition("called_by");
    }

    get(): void {

    }
}

class Account {
}

// bridge.when(bridge.tx.called_by(acc)).never(erc20.before().balanceOf(acc))

let process_method = new Method("process");
let account = new Account();
new Oracle("bridge").after(
    process_method.called_by(account)
).should(new Condition("never"));
