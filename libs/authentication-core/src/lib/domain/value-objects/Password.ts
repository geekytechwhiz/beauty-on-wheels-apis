export class Password{constructor(public readonly value:string){if(value.length<8)throw new Error('Weak password');}}
