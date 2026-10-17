using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NAudio.CoreAudioApi;

const string EndpointVolumeSessionId = "levcon:default-output-volume";

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

  if (command == "serve")
  {
    await RunServerAsync(options);
    return 0;
  }

  var result = ExecuteCommand(command, commandArgs);

  Console.Out.Write(JsonSerializer.Serialize(result, options));
  return 0;
}
catch (Exception exception)
{
  Console.Error.Write(exception.Message);
  return 1;
}

static object ExecuteCommand(string command, string[] commandArgs)
{
  return command switch
  {
    "list" => ListSessions(),
    "adjust-volume" => AdjustVolume(GetRequiredOption(commandArgs, "--id"), ParseInt(GetRequiredOption(commandArgs, "--delta")), ParseInt(GetOption(commandArgs, "--min") ?? "0"), ParseInt(GetOption(commandArgs, "--max") ?? "100")),
    "toggle-mute" => ToggleMute(GetRequiredOption(commandArgs, "--id")),
    _ => throw new InvalidOperationException($"Unknown command '{command}'."),
  };
}

static async Task RunServerAsync(JsonSerializerOptions options)
{
  while (true)
  {
    var line = await Console.In.ReadLineAsync();
    if (line is null)
    {
      return;
    }

    if (string.IsNullOrWhiteSpace(line))
    {
      continue;
    }

    try
    {
      var request = JsonSerializer.Deserialize<HelperRequest>(line, options)
        ?? throw new InvalidOperationException("Invalid helper request.");

      var result = ExecuteCommand(request.Command, BuildCommandArgs(request));
      await Console.Out.WriteLineAsync(JsonSerializer.Serialize(result, options));
      await Console.Out.FlushAsync();
    }
    catch (Exception exception)
    {
      await Console.Out.WriteLineAsync(JsonSerializer.Serialize(new ErrorResult(exception.Message), options));
      await Console.Out.FlushAsync();
    }
  }
}

static string[] BuildCommandArgs(HelperRequest request)
{
  return request.Command switch
  {
    "list" => ["--visibility", request.Visibility ?? "all"],
    "adjust-volume" => ["--id", request.Id ?? throw new InvalidOperationException("Missing id."), "--delta", (request.Delta ?? throw new InvalidOperationException("Missing delta.")).ToString(), "--min", (request.Min ?? 0).ToString(), "--max", (request.Max ?? 100).ToString()],
    "toggle-mute" => ["--id", request.Id ?? throw new InvalidOperationException("Missing id.")],
    _ => [],
  };
}

static object AdjustVolume(string sessionId, int delta, int min, int max)
{
  min = Math.Clamp(min, 0, 100);
  max = Math.Clamp(max, min, 100);
  if (sessionId == EndpointVolumeSessionId)
  {
    using var device = GetDefaultRenderDevice();
    var endpointTargetVolume = Math.Clamp((int)Math.Round(device.AudioEndpointVolume.MasterVolumeLevelScalar * 100f) + delta, min, max);
    device.AudioEndpointVolume.MasterVolumeLevelScalar = endpointTargetVolume / 100f;
    if (endpointTargetVolume > 0)
    {
      device.AudioEndpointVolume.Mute = false;
    }

    return new MutationResult(true);
  }

  using var session = FindSession(sessionId);
  if (session is null)
  {
    return new MutationResult(false);
  }

  var targetVolume = Math.Clamp((int)Math.Round(session.SimpleAudioVolume.Volume * 100f) + delta, min, max);
  session.SimpleAudioVolume.Volume = targetVolume / 100f;
  if (targetVolume > 0)
  {
    session.SimpleAudioVolume.Mute = false;
  }

  return new MutationResult(true);
}

static string BuildDisplayName(AudioSessionControl session)
{
  if (session.IsSystemSoundsSession)
  {
    return "System Sounds";
  }

  if (!string.IsNullOrWhiteSpace(session.DisplayName))
  {
    return session.DisplayName;
  }

  var processName = BuildProcessName(session);
  if (!string.IsNullOrWhiteSpace(processName))
  {
    return processName;
  }

  return $"PID {session.GetProcessID}";
}

static string? BuildIconDataUri(AudioSessionControl session)
{
  // Prefer an app-provided icon resource; protected games may deny process access.
  var sessionIcon = TryReadIcon(session.IconPath);
  return sessionIcon ?? TryReadIcon(GetSessionProcessPath(session));
}

static string? TryReadIcon(string? location)
{
  if (string.IsNullOrWhiteSpace(location)) return null;
  var path = Environment.ExpandEnvironmentVariables(location.Trim().TrimStart('@'));
  var index = 0;
  var comma = path.LastIndexOf(',');
  if (comma >= 0 && int.TryParse(path[(comma + 1)..].Trim(), out var resourceIndex))
  {
    index = resourceIndex;
    path = path[..comma];
  }
  path = path.Trim().Trim('"');
  if (!File.Exists(path)) return null;

  IntPtr large = IntPtr.Zero;
  IntPtr small = IntPtr.Zero;
  try
  {
    NativeMethods.ExtractIconEx(path, index, out large, out small, 1);
    var handle = large != IntPtr.Zero ? large : small;
  if (handle == IntPtr.Zero && index != 0) return null;
  using Icon? icon = handle != IntPtr.Zero ? (Icon)Icon.FromHandle(handle).Clone() : Icon.ExtractAssociatedIcon(path);
    if (icon is null) return null;
    using var bitmap = icon.ToBitmap();
    using var stream = new MemoryStream();
    bitmap.Save(stream, ImageFormat.Png);
    return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
  }
  catch
  {
    return null;
  }
  finally
  {
    if (large != IntPtr.Zero) NativeMethods.DestroyIcon(large);
    if (small != IntPtr.Zero && small != large) NativeMethods.DestroyIcon(small);
  }
}

static string BuildProcessName(AudioSessionControl session)
{
  var processPath = GetSessionProcessPath(session);
  if (!string.IsNullOrWhiteSpace(processPath))
  {
    return Path.GetFileName(processPath);
  }

  try
  {
    using var process = Process.GetProcessById((int)session.GetProcessID);
    return process.ProcessName + ".exe";
  }
  catch
  {
    return string.Empty;
  }
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

static object ListSessions()
{
  using var device = GetDefaultRenderDevice();
  var sessions = device.AudioSessionManager.Sessions;
  var visibleSessions = new List<SessionDto>();

  for (var index = 0; index < sessions.Count; index += 1)
  {
    using var session = sessions[index];

    var active = session.State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateActive;

    visibleSessions.Add(new SessionDto(
        GetSessionId(session),
        BuildDisplayName(session),
        BuildIconDataUri(session),
        BuildProcessName(session),
        session.GetProcessID,
        GetCachedProcessCommandLine(session.GetProcessID),
      false,
      session.GetSessionIdentifier,
      session.GetSessionInstanceIdentifier,
      session.GetGroupingParam().ToString(),
      session.State.ToString(),
      session.AudioMeterInformation.MasterPeakValue,
      session.IsSystemSoundsSession,
        (int)Math.Round(session.SimpleAudioVolume.Volume * 100f),
        session.SimpleAudioVolume.Mute,
        active));
  }

  return new SessionListResult(BuildEndpointVolume(device), visibleSessions);
}

static SessionDto BuildEndpointVolume(MMDevice device)
{
  return new SessionDto(
    EndpointVolumeSessionId,
    "Output Volume",
    null,
    "System",
    0,
    null,
    true,
    device.ID,
    device.ID,
    device.ID,
    device.State.ToString(),
    device.AudioMeterInformation.MasterPeakValue,
    false,
    (int)Math.Round(device.AudioEndpointVolume.MasterVolumeLevelScalar * 100f),
    device.AudioEndpointVolume.Mute,
    true);
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
  if (sessionId == EndpointVolumeSessionId)
  {
    using var device = GetDefaultRenderDevice();
    device.AudioEndpointVolume.Mute = !device.AudioEndpointVolume.Mute;
    return new MutationResult(true);
  }

  using var session = FindSession(sessionId);
  if (session is null)
  {
    return new MutationResult(false);
  }

  session.SimpleAudioVolume.Mute = !session.SimpleAudioVolume.Mute;
  return new MutationResult(true);
}

static string? GetSessionProcessPath(AudioSessionControl session)
{
  var processPath = TryGetProcessPath(session.GetProcessID);
  if (!string.IsNullOrWhiteSpace(processPath))
  {
    return processPath;
  }

  // Protected games can deny module access while Core Audio still exposes
  // their executable in the session identifier. Read the icon from disk.
  var identifier = session.GetSessionIdentifier;
  var start = identifier?.IndexOf('|') ?? -1;
  var end = start >= 0 ? identifier!.IndexOf("%b", start + 1, StringComparison.Ordinal) : -1;
  if (start < 0 || end <= start + 1)
  {
    return null;
  }

  var sessionPath = identifier![(start + 1)..end];
  if (!sessionPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
  {
    return null;
  }

  if (sessionPath.StartsWith(@"\Device\", StringComparison.OrdinalIgnoreCase))
  {
    foreach (var drive in Environment.GetLogicalDrives())
    {
      var deviceName = new StringBuilder(32768);
      if (NativeMethods.QueryDosDevice(drive[..2], deviceName, deviceName.Capacity) != 0)
      {
        var prefix = deviceName.ToString() + @"\";
        if (sessionPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
          return drive + sessionPath[prefix.Length..];
        }
      }
    }

    return null;
  }

  if (sessionPath.Length > 3 && char.IsLetter(sessionPath[0]) && sessionPath[1] == ':' && sessionPath[2] == '\\')
  {
    return sessionPath;
  }

  return null;
}

static string? TryGetProcessPath(uint processId)
{
  if (processId == 0)
  {
    return null;
  }

  // PROCESS_QUERY_LIMITED_INFORMATION works when reading MainModule is denied.
  using (var handle = NativeMethods.OpenProcess(0x1000, false, processId))
  {
    if (!handle.IsInvalid)
    {
      var buffer = new StringBuilder(32768);
      var length = buffer.Capacity;
      if (NativeMethods.QueryFullProcessImageName(handle, 0, buffer, ref length)) return buffer.ToString();
    }
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

static string? GetCachedProcessCommandLine(uint processId)
{
  if (processId == 0)
  {
    return null;
  }

  if (!HelperCache.ProcessCommandLineById.TryGetValue(processId, out var commandLine))
  {
    commandLine = TryGetProcessCommandLine(processId);
    HelperCache.ProcessCommandLineById[processId] = commandLine;
  }

  return commandLine;
}

static string? TryGetProcessCommandLine(uint processId)
{
  if (processId == 0)
  {
    return null;
  }

  try
  {
    using var searcher = new ManagementObjectSearcher($"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {processId}");
    using var results = searcher.Get();
    foreach (ManagementObject process in results)
    {
      return process["CommandLine"]?.ToString();
    }
  }
  catch
  {
    return null;
  }

  return null;
}

record MutationResult(bool Ok);

record ErrorResult(string Error);

record HelperRequest(
  string Command,
  string? Visibility,
  string? Id,
  int? Delta,
  int? Min,
  int? Max
);

record SessionDto(
  string Id,
  string DisplayName,
  string? IconDataUri,
  string ProcessName,
  uint ProcessId,
  string? ProcessCommandLine,
  bool IsOutputVolume,
  string? SessionIdentifier,
  string? SessionInstanceIdentifier,
  string GroupingParam,
  string State,
  float PeakValue,
  bool IsSystemSoundsSession,
  int Volume,
  bool Muted,
  bool Active
);

record SessionListResult(SessionDto Endpoint, IReadOnlyList<SessionDto> Sessions);

static class HelperCache
{
  public static readonly Dictionary<uint, string?> ProcessCommandLineById = [];
}

static class NativeMethods
{
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern Microsoft.Win32.SafeHandles.SafeProcessHandle OpenProcess(uint access, bool inheritHandle, uint processId);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  internal static extern bool QueryFullProcessImageName(Microsoft.Win32.SafeHandles.SafeProcessHandle process, uint flags, StringBuilder name, ref int size);

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "ExtractIconExW")]
  internal static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  internal static extern bool DestroyIcon(IntPtr icon);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "QueryDosDeviceW")]
  internal static extern uint QueryDosDevice(string deviceName, StringBuilder targetPath, int maxLength);
}
