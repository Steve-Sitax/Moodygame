using System;

namespace Scheldemist.Play;

public partial class Jobs
{
    public Func<Item,float,float,Act?>? CartCarryAction;
    public void CartLifted(Item item) => run?.OnLifted(item);
    public void CartDelivered(int jobId,Item item)
    {
        // The server already made unloaded goods the employer's (job=null). Replay its delivery
        // fact into the existing run counter without changing that authoritative goods record.
        if(jobId==active?.Id)run?.OnPlaced(new Item {S=item.S with {Job=jobId}});
        else Tally(jobId,"delivered");
    }
}
