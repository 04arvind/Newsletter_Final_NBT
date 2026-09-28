import { NextRequest, NextResponse } from "next/server";
import { getSubscribersCollection } from '../../../lib/db/client'
import { verifyUnsubscribeToken } from '../../../lib/unsubscribe-token'

export async function POST(req:NextRequest){
    try{
        const {email,category} = await req.json();
        if(!email){
            return NextResponse.json({error:'Email required'},{status:400});
        }
        const selectedCategory = typeof category === 'string' && category.trim()
            ? category.trim()
            : undefined;
        const subscribers = await getSubscribersCollection();
        //  Looked up by email because that is all the site knows, then removed
        //  by its `_id` so exactly the row that was found is the row deleted.
        const subscriber = await subscribers.findOne({email});
        if(!subscriber){
            return NextResponse.json({error:'Email not found'},{status:404});
        }
        //  One newsletter at a time: drop just that category and keep the
        //  subscriber for the ones they still take. The row goes only once
        //  nothing is left on it.
        if(selectedCategory){
            const remaining = await subscribers.findOneAndUpdate(
                {_id:subscriber._id},
                {$pull:{categories:selectedCategory}},
                {returnDocument:'after'},
            )
            if(remaining?.categories?.length){
                return NextResponse.json({message:'Unsubscribed',categories:remaining.categories});
            }
        }
        await subscribers.deleteOne({_id:subscriber._id});
        return NextResponse.json({message:'Unsubscribed',categories:[]});
    }
    catch(err){
        console.log('Unsubscribe error',err);
        return NextResponse.json({error : 'Something went wrong'},{status:500});
    }
}

//  The page the email link lands on afterwards (src/app/unsubcribe/page.tsx).
const UNSUBSCRIBED_PAGE_PATH = '/unsubcribe';

//  Where the email link lands afterwards. Set UNSUB_REDIRECT_URL to override it;
//  otherwise it is the unsubscribed page on NEXT_PUBLIC_APP_URL (e.g.
//  http://localhost:3000 -> http://localhost:3000/unsubcribe), falling back to
//  this request's own origin.
function unsubscribeRedirectUrl(req:NextRequest){
    const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin).replace(/\/+$/,'');
    return process.env.UNSUB_REDIRECT_URL?.trim() || `${base}${UNSUBSCRIBED_PAGE_PATH}`;
}

//  one click unsubscribe link from emails : /api/unsubscribe?email=...&token=...
//  Always redirects, valid token or not, so the link never shows an error page.
export async function GET(req:NextRequest){
    const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
    const token = req.nextUrl.searchParams.get('token');
    try{
        if(!email || !token || !verifyUnsubscribeToken(email,token)){
            console.error('Unsubscribe error: invalid token',{email});
        }
        else{
            const subscribers = await getSubscribersCollection();
            await subscribers.updateOne(
                {email},
                {$set:{status:'unsubscribed',unsubscribed:true,unsubscribedAt:new Date()}},
            )
        }
    }
    catch(err){
        console.error('Unsubscribe error',err);
    }
    return NextResponse.redirect(unsubscribeRedirectUrl(req),302);
}
