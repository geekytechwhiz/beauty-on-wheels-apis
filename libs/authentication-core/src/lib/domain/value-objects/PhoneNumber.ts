export class PhoneNumber{constructor(public readonly value:string){if(value.length<8)throw new Error('Invalid phone');}}
