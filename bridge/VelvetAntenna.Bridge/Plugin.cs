using System;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using VelvetAntenna.Bridge.Configuration;

namespace VelvetAntenna.Bridge;

public sealed class Plugin : BasePlugin<PluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    public override string Name => "Velvet Antenna Bridge";

    public override Guid Id => Guid.Parse("d6f19488-6a7d-4c1f-9418-b3d56e5e7201");

    public override string Description => "Read-only metadata bridge for Velvet Antenna source-aware collection completeness.";
}
