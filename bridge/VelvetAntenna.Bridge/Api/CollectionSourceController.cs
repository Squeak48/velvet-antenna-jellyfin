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
public sealed class CollectionSourceController : ControllerBase
{
    private const string TmdbManagerTypeName = "MediaBrowser.Providers.Plugins.Tmdb.TmdbClientManager, MediaBrowser.Providers";
    private readonly IServiceProvider _services;

    public CollectionSourceController(IServiceProvider services)
    {
        _services = services;
    }

    [HttpGet("TmdbCollection/{tmdbId:int}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult> GetTmdbCollection(int tmdbId, CancellationToken cancellationToken)
    {
        if (tmdbId <= 0)
        {
            return BadRequest(new { error = "A positive TMDb collection id is required." });
        }

        var managerType = Type.GetType(TmdbManagerTypeName, throwOnError: false);
        if (managerType is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Jellyfin TMDb provider is unavailable." });
        }

        var manager = _services.GetService(managerType);
        if (manager is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Jellyfin TMDb client is not registered." });
        }

        var method = managerType
            .GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .FirstOrDefault(candidate => candidate.Name == "GetCollectionAsync" && candidate.GetParameters().Length == 5);

        if (method is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Jellyfin TMDb collection lookup is unavailable." });
        }

        object? invocation;
        try
        {
            invocation = method.Invoke(manager, new object?[] { tmdbId, null, null, null, cancellationToken });
        }
        catch (TargetInvocationException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = ex.InnerException?.Message ?? ex.Message });
        }

        if (invocation is not Task task)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Unexpected TMDb client response." });
        }

        try
        {
            await task.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = ex.Message });
        }

        var collection = invocation.GetType().GetProperty("Result", BindingFlags.Instance | BindingFlags.Public)?.GetValue(invocation);
        if (collection is null)
        {
            return NotFound(new { error = "TMDb collection was not found." });
        }

        var posterMethod = managerType.GetMethod("GetPosterUrl", BindingFlags.Instance | BindingFlags.Public, new[] { typeof(string) });
        var parts = new List<object>();
        if (Read(collection, "Parts") is IEnumerable enumerable)
        {
            foreach (var part in enumerable)
            {
                if (part is null)
                {
                    continue;
                }

                var id = ToInt(Read(part, "Id"));
                if (id <= 0)
                {
                    continue;
                }

                var posterPath = Read(part, "PosterPath") as string;
                string? posterUrl = null;
                if (posterMethod is not null && !string.IsNullOrWhiteSpace(posterPath))
                {
                    try
                    {
                        posterUrl = posterMethod.Invoke(manager, new object?[] { posterPath }) as string;
                    }
                    catch
                    {
                        posterUrl = null;
                    }
                }

                parts.Add(new
                {
                    tmdbId = id,
                    title = (Read(part, "Title") as string) ?? (Read(part, "OriginalTitle") as string) ?? string.Empty,
                    originalTitle = Read(part, "OriginalTitle") as string,
                    year = ToYear(Read(part, "ReleaseDate")),
                    overview = Read(part, "Overview") as string,
                    posterUrl
                });
            }
        }

        return Ok(new
        {
            source = "TMDb",
            collectionId = ToInt(Read(collection, "Id")),
            name = Read(collection, "Name") as string,
            overview = Read(collection, "Overview") as string,
            parts
        });
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

    private static int? ToYear(object? value)
    {
        return value switch
        {
            DateTime date => date.Year,
            DateTimeOffset date => date.Year,
            _ => null
        };
    }
}
