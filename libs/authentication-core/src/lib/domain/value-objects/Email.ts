export class Email{constructor(public readonly value:string){if(!/^\S+@\S+\.\S+$/.test(value))throw new Error('Invalid email');}}
