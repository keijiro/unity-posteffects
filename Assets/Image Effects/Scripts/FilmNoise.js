#pragma strict

@script ExecuteInEditMode
@script RequireComponent(Camera)
@script AddComponentMenu("Image Effects/Flim Noise")

class FilmNoise extends PostEffectsBase {
    @Range(0.0, 1.0) var grainIntensity = 0.2;
    @Range(1.0, 4.0) var grainScale = 2.0;

    @HideInInspector var grainTexture : Texture2D;
    @HideInInspector var shader : Shader;

    private var material : Material;

    function CheckResources() {
        material = CheckShaderAndCreateMaterial(shader, material);
        return CheckSupport();
    }

    function OnRenderImage(source : RenderTexture, destination : RenderTexture) {
        if (!CheckResources()) {
            ReportAutoDisable();
            Graphics.Blit(source, destination);
            return;
        }

        var uvmod = Vector4(
            Random.value,
            Random.value,
            grainScale * Screen.width / grainTexture.width,
            grainScale * Screen.height / grainTexture.height
        );

        material.SetTexture("noise_tex", grainTexture);
        material.SetVector("uvmod", uvmod);
        material.SetFloat("intensity", grainIntensity * Random.Range(0.9, 1.0));
        Graphics.Blit(source, destination, material);
    }
}
