import {NextRequest, NextResponse} from "next/server";
import { getSubscribersCollection } from '../../../lib/db/client'

export async function POST(req : NextRequest){
    try{
        const {email,category} = await req.json();
        if(!email || typeof email !== 'string' ||!/^\S+@\S+\.\S+$/.test(email)){
            return NextResponse.json({error:'Valid email is required'},{status:400});
        }
        //  The category is what the card the reader subscribed from is about.
        //  Optional, so the email one-click link below keeps working unchanged.
        const selectedCategory = typeof category === 'string' && category.trim()
            ? category.trim()
            : undefined;
        const subscribers = await getSubscribersCollection();
        const existing = await subscribers.findOne({email});
        if(existing){
            //  Same address, another newsletter: add the category and leave the
            //  rest of the record — and the categories already on it — alone.
            if(existing.status==='active'){
                if(selectedCategory){
                    await subscribers.updateOne({email},{$addToSet:{categories:selectedCategory}})
                }
                return NextResponse.json({message:'Already subscribed'},{status:200});
            }
            await subscribers.updateOne(
                {email},
                {$set:{status:'active',unsubscribedAt:null},...(selectedCategory?{$addToSet:{categories:selectedCategory}}:{})},
            )
            return NextResponse.json({message:'Resubscribed'},{status:200});
        }
        await subscribers.insertOne({email,status:'active',subscribedAt:new Date(),unsubscribedAt:null,categories:selectedCategory?[selectedCategory]:[]})
        return NextResponse.json({message:'Subscribed'},{status:201});
    }
    catch(err){
        console.error('Subscribe error',err);
        return NextResponse.json({error:'Something went wrong'},{status:500});
    }
}

//  one click subscribe link from emails : /api/subscribe?email=...
//  The newsletter footer renders this as a plain <a href> (see
//  src/lib/email/subscription-links.ts) because an email cannot POST, so the
//  same branch the handler above runs is reachable over GET as well — this is
//  how /api/unsubscribe already serves its one-click link.
export async function GET(req:NextRequest){
    try{
        const email = req.nextUrl.searchParams.get('email');
        if(!email || !/^\S+@\S+\.\S+$/.test(email)){
            return NextResponse.json({error:'Valid email is required'},{status:400});
        }
        const subscribers = await getSubscribersCollection();
        const existing = await subscribers.findOne({email});
        if(existing){
            if(existing.status==='active'){
                return NextResponse.json({message:'Already subscribed'},{status:200});
            }
            await subscribers.updateOne(
                {email},
                {$set:{status:'active',unsubscribedAt:null}},
            )
            return NextResponse.json({message:'Resubscribed'},{status:200});
        }
        await subscribers.insertOne({email,status:'active',subscribedAt:new Date(),unsubscribedAt:null})
        return NextResponse.json({message:'Subscribed'},{status:201});
    }
    catch(err){
        console.error('Subscribe error',err);
        return NextResponse.json({error:'Something went wrong'},{status:500});
    }
}
