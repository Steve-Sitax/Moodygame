using System;
using System.Linq;
using System.Reflection;

namespace Scheldemist.World;

/// <summary>Build-time construction source revision. Other gameplay, UI, backend and test edits keep valid geometry.</summary>
public static class StartupCacheCode
{
    public static string Revision(Assembly assembly) => assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
        .FirstOrDefault(a=>a.Key=="StartupGeometryCode")?.Value
        ?? assembly.ManifestModule.ModuleVersionId.ToString(); // Older/custom build: conservatively invalidate.
}
