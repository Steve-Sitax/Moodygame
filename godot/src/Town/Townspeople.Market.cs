using System;

namespace Scheldemist.Town;

public partial class Townspeople
{
    public Func<Puppet,string,double,bool>? MarketBrowse;
    public Action<Puppet>? MarketForget;
}
