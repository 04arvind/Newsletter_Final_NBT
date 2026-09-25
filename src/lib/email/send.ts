import {Resend} from 'resend';

// Constructed lazily: `new Resend()` throws when RESEND_API_KEY is unset, and at
// module scope that crashes `next build` while it collects page data.
let resend: Resend | null = null;
function getResend(){
    if(!resend){
        const apiKey = process.env.RESEND_API_KEY;
        if(!apiKey){
            throw new Error('RESEND_API_KEY is not set. Add it to your .env file to send newsletter emails.');
        }
        resend = new Resend(apiKey);
    }
    return resend;
}

interface SendEmailParams{
    to:string
    subject:string
    html:string
}
export async function sendEmail({to,subject,html}:SendEmailParams){
    const {data,error} = await getResend().emails.send({
        from: process.env.NEWSLETTER_FROM_EMAIL || 'newsletter@yourdomain.com',
        to,
        subject,
        html,
    })
    if(error){
        throw new Error(`Failed to send to ${to}: ${error.message}`);
    }
    return data;
}