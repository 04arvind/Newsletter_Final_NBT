import { NextRequest, NextResponse } from "next/server";
import { getSubscribersCollection } from '../../../lib/db/client'

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

//  one click unsubscribe link from emails : /api/unsubscribe?email=...
export async function GET(req:NextRequest){
    const email = req.nextUrl.searchParams.get('email');
    if(!email){
        return NextResponse.json({error:'Email required'},{status:400});
    }
    const subscribers = await getSubscribersCollection();
    await subscribers.updateOne(
        {email},
        {$set:{status:'unsubscribed',unsubscribedAt:new Date()}},
    )
    return NextResponse.json({message : 'Unsubscribed'});
}
