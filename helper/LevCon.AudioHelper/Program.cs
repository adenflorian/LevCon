using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using NAudio.CoreAudioApi;

var options = new JsonSerializerOptions
{
  PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
  DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
  WriteIndented = false,
};

try
{
  if (args.Length == 0)
  {
    throw new InvalidOperationException("Missing command.");
  }

  var command = args[0];
  var commandArgs = args.Skip(1).ToArray();
  var result = command switch
  {
    "list" => ListSessions(GetOption(commandArgs, "--visibility") ?? "all"),
    "adjust-volume" => AdjustVolume(GetRequiredOption(commandArgs, "--id"), ParseInt(GetRequiredOption(commandArgs, "--delta"))),
    "toggle-mute" => ToggleMute(GetRequiredOption(commandArgs, "--id")),
    _ => throw new InvalidOperationException($"Unknown command '{command}'."),
  };

  Console.Out.Write(JsonSerializer.Serialize(result, options));
  return 0;
}
catch (Exception exception)
{
  Console.Error.Write(exception.Message);
  return 1;
}

static object AdjustVolume(string sessionId, int delta)
{
  using var session = FindSession(sessionId);
  if (session is null)
  {
    return new MutationResult(false);
  }

  var targetVolume = Math.Clamp((int)Math.Round(session.SimpleAudioVolume.Volume * 100f) + delta, 0, 100);
  session.SimpleAudioVolume.Volume = targetVolume / 100f;
  if (targetVolume > 0)
  {
    session.SimpleAudioVolume.Mute = false;
  }

  return new MutationResult(true);
}

static string BuildDisplayName(AudioSessionControl session)
{
  if (!string.IsNullOrWhiteSpace(session.DisplayName))
  {
    return session.DisplayName;
  }

  var processName = TryGetProcessName(session.GetProcessID);
  if (!string.IsNullOrWhiteSpace(processName))
  {
    return processName;
  }

  return session.IsSystemSoundsSession ? "System Sounds" : $"PID {session.GetProcessID}";
}

static string? BuildIconDataUri(AudioSessionControl session)
{
  var processPath = TryGetProcessPath(session.GetProcessID);
  if (string.IsNullOrWhiteSpace(processPath) || !File.Exists(processPath))
  {
    return null;
  }

  try
  {
    using Icon? icon = Icon.ExtractAssociatedIcon(processPath);
    if (icon is null)
    {
      return null;
    }

    using var bitmap = icon.ToBitmap();
    using var stream = new MemoryStream();
    bitmap.Save(stream, ImageFormat.Png);
    return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
  }
  catch
  {
    return null;
  }
}

static string BuildProcessName(AudioSessionControl session)
{
  return TryGetProcessName(session.GetProcessID) ?? string.Empty;
}

static MMDevice GetDefaultRenderDevice()
{
  using var enumerator = new MMDeviceEnumerator();
  return enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
}

static string GetRequiredOption(string[] arguments, string name)
{
  return GetOption(arguments, name) ?? throw new InvalidOperationException($"Missing required option '{name}'.");
}

static string? GetOption(string[] arguments, string name)
{
  for (var index = 0; index < arguments.Length - 1; index += 1)
  {
    if (arguments[index] == name)
    {
      return arguments[index + 1];
    }
  }

  return null;
}

static AudioSessionControl? FindSession(string sessionId)
{
  using var device = GetDefaultRenderDevice();
  var sessions = device.AudioSessionManager.Sessions;
  for (var index = 0; index < sessions.Count; index += 1)
  {
    var session = sessions[index];
    if (GetSessionId(session) == sessionId)
    {
      return session;
    }

    session.Dispose();
  }

  return null;
}

static object ListSessions(string visibility)
{
  using var device = GetDefaultRenderDevice();
  var sessions = device.AudioSessionManager.Sessions;
  var visibleSessions = new List<SessionDto>();

  for (var index = 0; index < sessions.Count; index += 1)
  {
    using var session = sessions[index];

    var active = session.State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateActive;
    if (visibility == "active" && !active)
    {
      continue;
    }

    visibleSessions.Add(new SessionDto(
        GetSessionId(session),
        BuildDisplayName(session),
      BuildIconDataUri(session),
        BuildProcessName(session),
        (int)Math.Round(session.SimpleAudioVolume.Volume * 100f),
        session.SimpleAudioVolume.Mute,
        active));
  }

  return new SessionListResult(visibleSessions);
}

static int ParseInt(string value)
{
  return int.TryParse(value, out var parsed)
      ? parsed
      : throw new InvalidOperationException($"Expected integer but received '{value}'.");
}

static string GetSessionId(AudioSessionControl session)
{
  if (!string.IsNullOrWhiteSpace(session.GetSessionInstanceIdentifier))
  {
    return session.GetSessionInstanceIdentifier;
  }

  if (!string.IsNullOrWhiteSpace(session.GetSessionIdentifier))
  {
    return session.GetSessionIdentifier;
  }

  return $"pid:{session.GetProcessID}:{session.DisplayName}";
}

static object ToggleMute(string sessionId)
{
  using var session = FindSession(sessionId);
  if (session is null)
  {
    return new MutationResult(false);
  }

  session.SimpleAudioVolume.Mute = !session.SimpleAudioVolume.Mute;
  return new MutationResult(true);
}

static string? TryGetProcessName(uint processId)
{
	var processPath = TryGetProcessPath(processId);
	if (!string.IsNullOrWhiteSpace(processPath))
	{
		return Path.GetFileName(processPath);
	}

	return null;
}

static string? TryGetProcessPath(uint processId)
{
  if (processId == 0)
  {
    return null;
  }

  try
  {
    using var process = Process.GetProcessById((int)processId);
    return process.MainModule?.FileName;
  }
  catch
  {
    return null;
  }
}

record MutationResult(bool Ok);

record SessionDto(string Id, string DisplayName, string? IconDataUri, string ProcessName, int Volume, bool Muted, bool Active);

record SessionListResult(IReadOnlyList<SessionDto> Sessions);