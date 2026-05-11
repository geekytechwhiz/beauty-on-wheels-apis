import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { EventTransport } from "../core/schema/define-event";


const clientFactory = {
    eventbridge: new EventBridgeClient({ region: process.env.AWS_REGION! }),
    sqs: new SQSClient({ region: process.env.AWS_REGION! }),
    sns: new SNSClient({ region: process.env.AWS_REGION! }),
}

 

export const createClientInstance = (transport: EventTransport)=>{
    return clientFactory[transport];
}