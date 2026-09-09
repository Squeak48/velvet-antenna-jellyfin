using System.Collections;
using System.Globalization;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace VelvetAntenna.Bridge.Api;

[ApiController]
[Authorize]
[Route("VelvetAntennaBridge")]
public sealed class SeriesSourceController : ControllerBase
{
    private const string TmdbManagerTypeName = "MediaBrowser.Providers.Plugins.Tmdb.TmdbClientManager, MediaBrowser.Providers";
    private readonly IServiceProvider _services;

    public SeriesSourceController(IServiceProvider services)
    {
        _services = services;
    }

    [HttpGet("TmdbSeries/{tmdbId:int}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult> GetTmdbSeries(int tmdbId, CancellationToken cancellationToken)
    {
        if (tmdbId <= 0)
        {
            return BadRequest(new { error = "A positive TMDb series id is required." });
        }

        var resolved = ResolveManager();
        if (resolved.Error is not null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = resolved.Error });
        }

        var series = await InvokeAsync(
            resolved.ManagerType!,
            resolved.Manager!,
            "GetSeriesAsync",
            5,
            new object?[] { tmdbId, null, null, null, cancellationToken }).ConfigureAwait(false);

        if (series.Error is not null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = series.Error });
        }

        if (series.Value is null)
        {
            return NotFound(new { error = "TMDb series was not found." });
        }

        var seasons = new List<object>();
        if (Read(series.Value, "Seasons") is IEnumerable enumerable)
        {
            foreach (var season in enumerable)
            {
                if (season is null)
                {
                    continue;
                }

                var seasonNumber = ToInt(Read(season, "SeasonNumber"));
                if (seasonNumber < 0)
                {
                    continue;
                }

                seasons.Add(new
                {
                    seasonNumber,
                    name = Read(season, "Name") as string,
                    episodeCount = Math.Max(0, ToInt(Read(season, "EpisodeCount"))),
                    airDate = ToDate(Read(season, "AirDate")),
                    tmdbId = ToInt(Read(season, "Id"))
                });
            }
        }

        return Ok(new
        {
            source = "TMDb",
            seriesId = ToInt(Read(series.Value, "Id")),
            name = Read(series.Value, "Name") as string,
            originalName = Read(series.Value, "OriginalName") as string,
            status = Read(series.Value, "Status")?.ToString(),
            firstAirDate = ToDate(Read(series.Value, "FirstAirDate")),
            lastAirDate = ToDate(Read(series.Value, "LastAirDate")),
            numberOfSeasons = ToInt(Read(series.Value, "NumberOfSeasons")),
            numberOfEpisodes = ToInt(Read(series.Value, "NumberOfEpisodes")),
            seasons
        });
    }

    [HttpGet("TmdbSeries/{tmdbId:int}/Season/{seasonNumber:int}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult> GetTmdbSeason(int tmdbId, int seasonNumber, CancellationToken cancellationToken)
    {
        if (tmdbId <= 0 || seasonNumber < 0)
        {
            return BadRequest(new { error = "A positive TMDb series id and non-negative season number are required." });
        }

        var resolved = ResolveManager();
        if (resolved.Error is not null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = resolved.Error });
        }

        var season = await InvokeAsync(
            resolved.ManagerType!,
            resolved.Manager!,
            "GetSeasonAsync",
            6,
            new object?[] { tmdbId, seasonNumber, null, null, null, cancellationToken }).ConfigureAwait(false);

        if (season.Error is not null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = season.Error });
        }

        if (season.Value is null)
        {
            return NotFound(new { error = "TMDb season was not found." });
        }

        var episodes = new List<object>();
        if (Read(season.Value, "Episodes") is IEnumerable enumerable)
        {
            foreach (var episode in enumerable)
            {
                if (episode is null)
                {
                    continue;
                }

                var episodeNumber = ToInt(Read(episode, "EpisodeNumber"));
                if (episodeNumber <= 0)
                {
                    continue;
                }

                episodes.Add(new
                {
                    episodeNumber,
                    name = Read(episode, "Name") as string,
                    airDate = ToDate(Read(episode, "AirDate")),
                    tmdbId = ToInt(Read(episode, "Id")),
                    runtime = ToNullableInt(Read(episode, "Runtime"))
                });
            }
        }

        return Ok(new
        {
            source = "TMDb",
            seriesId = tmdbId,
            seasonNumber,
            name = Read(season.Value, "Name") as string,
            airDate = ToDate(Read(season.Value, "AirDate")),
            episodes
        });
    }

    private (Type? ManagerType, object? Manager, string? Error) ResolveManager()
    {
        var managerType = Type.GetType(TmdbManagerTypeName, throwOnError: false);
        if (managerType is null)
        {
            return (null, null, "Jellyfin TMDb provider is unavailable.");
        }

        var manager = _services.GetService(managerType);
        return manager is null
            ? (managerType, null, "Jellyfin TMDb client is not registered.")
            : (managerType, manager, null);
    }

    private static async Task<(object? Value, string? Error)> InvokeAsync(
        Type managerType,
        object manager,
        string methodName,
        int parameterCount,
        object?[] arguments)
    {
        var method = managerType
            .GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .FirstOrDefault(candidate => candidate.Name == methodName && candidate.GetParameters().Length == parameterCount);

        if (method is null)
        {
            return (null, $"Jellyfin TMDb {methodName} lookup is unavailable.");
        }

        object? invocation;
        try
        {
            invocation = method.Invoke(manager, arguments);
        }
        catch (TargetInvocationException ex)
        {
            return (null, ex.InnerException?.Message ?? ex.Message);
        }
        catch (Exception ex)
        {
            return (null, ex.Message);
        }

        if (invocation is not Task task)
        {
            return (null, "Unexpected TMDb client response.");
        }

        try
        {
            await task.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            return (null, ex.Message);
        }

        var value = invocation.GetType().GetProperty("Result", BindingFlags.Instance | BindingFlags.Public)?.GetValue(invocation);
        return (value, null);
    }

    private static object? Read(object value, string propertyName)
        => value.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public)?.GetValue(value);

    private static int ToInt(object? value)
    {
        if (value is null)
        {
            return 0;
        }

        try
        {
            return Convert.ToInt32(value, CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    private static int? ToNullableInt(object? value)
    {
        if (value is null)
        {
            return null;
        }

        try
        {
            return Convert.ToInt32(value, CultureInfo.InvariantCulture);
        }
        catch
        {
            return null;
        }
    }

    private static string? ToDate(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is DateTime date)
        {
            return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (value is DateTimeOffset offset)
        {
            return offset.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (DateTime.TryParse(value.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            return parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return null;
    }
}
