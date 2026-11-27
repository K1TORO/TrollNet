# Build context: repository root (see docker-compose.yml)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props ./
COPY src/Shared/TrollNet.Shared/TrollNet.Shared.csproj src/Shared/TrollNet.Shared/
COPY src/Services/AiService/AiService.csproj src/Services/AiService/
RUN dotnet restore src/Services/AiService/AiService.csproj

COPY src/Shared/ src/Shared/
COPY src/Services/AiService/ src/Services/AiService/
RUN dotnet publish src/Services/AiService/AiService.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "AiService.dll"]
